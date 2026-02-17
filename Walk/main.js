import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();

// Gradient Background
const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#e0e0e0'); 
gradient.addColorStop(1, '#444444'); 
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

// CAMERA RIG SYSTEM (Crucial for switching modes)
const cameraRig = new THREE.Group();
scene.add(cameraRig);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
cameraRig.add(camera); // Camera must be a child of the rig

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- 2. VARIABLES & STATE ---
let yaw = Math.PI, pitch = 0; // Start facing backward (towards room) if needed
const homeData = { pos: new THREE.Vector3(0, 0, 0), yaw: Math.PI };
let clippingBox = new THREE.Box3();
let hasClipping = false;
let intersectPoint = null;

// Desktop/Mobile Input State
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

// --- 3. LOADER SETUP ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

// --- 4. VR CONTROLLERS ---
const raycaster = new THREE.Raycaster();
const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 })
);
marker.visible = false;
scene.add(marker);

const controller1 = renderer.xr.getController(0);
controller1.addEventListener('selectstart', () => {
    if (intersectPoint && marker.visible) {
        // Teleport the RIG, not the camera
        cameraRig.position.set(intersectPoint.x, intersectPoint.y, intersectPoint.z);
    }
});
cameraRig.add(controller1);

const controllerModelFactory = new XRControllerModelFactory();
const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
cameraRig.add(grip1);

// --- 5. CRITICAL FIX: SESSION MANAGER ---
// This resets the camera when you TAKE OFF the headset
renderer.xr.addEventListener('sessionend', () => {
    // 1. Reset Camera Local Position (Eyes at 1.6m height)
    camera.position.set(0, 1.6, 0);
    // 2. Reset Camera Rotation (Look straight ahead)
    camera.rotation.set(0, 0, 0);
    // 3. Sync rotation variables so mouse doesn't "snap"
    pitch = 0;
    // We keep 'yaw' as is, so you face the same direction you were looking
});

renderer.xr.addEventListener('sessionstart', () => {
    // In VR, the camera local position is managed by the headset
    camera.position.set(0, 0, 0);
});

// --- 6. FUNCTIONS ---
function goHome() {
    cameraRig.position.copy(homeData.pos);
    yaw = homeData.yaw; 
    pitch = 0;
    
    // Ensure height is correct based on mode
    if (!renderer.xr.isPresenting) {
        camera.position.set(0, 1.6, 0);
    } else {
        camera.position.set(0, 0, 0);
    }
}

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();

        if (isMain) {
            // A. START POSITION - Look for exact match or specific prefix
            if (name === "start" || name.startsWith("start_")) {
                child.getWorldPosition(homeData.pos);
                homeData.pos.y = 0; 
                const worldQuat = new THREE.Quaternion();
                child.getWorldQuaternion(worldQuat);
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y + Math.PI;
                child.visible = false;
                return;
            }

            // B. CLIPPING - Only hide if the name is EXACTLY "clip" or "collision_clip"
            // This prevents "Partition" walls from being hidden
            if (name === "clip" || name === "collision_clip") {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                if(child.material) child.material.visible = false; 
                child.userData.isClip = true; 
                hasClipping = true;
                return;
            }

            // C. FLOOR - Only hide the main navigation floor
            // Change this to match the EXACT name of your invisible nav floor in Blender
            if (name === "floor" || name === "teleport_floor") {
                child.userData.isFloor = true; 
                if(child.material) child.material.visible = false; 
                return; // Exit early so it doesn't get baked textures
            }
        }

        // Apply Baked Textures to everything else
        // (This will now include your Partition Wall because it's no longer caught above)
        if (child.isMesh && child.material && child.material.map) {
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0; 
            child.material.color = new THREE.Color(0x000000);
        }
    });
    scene.add(gltf.scene);
    if (isMain) goHome();
}

function handleVRRaycast() {
    if (!controller1) return;
    const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(scene.children, true);
    const floorHit = intersects.find(hit => hit.object.userData.isFloor);

    if (floorHit) {
        if (!hasClipping || clippingBox.containsPoint(floorHit.point)) {
            intersectPoint = floorHit.point;
            marker.position.copy(intersectPoint);
            marker.visible = true;
            marker.material.color.set(0x00ff00);
        } else {
            marker.position.copy(floorHit.point);
            marker.visible = true;
            marker.material.color.set(0xff0000);
            intersectPoint = null;
        }
    } else {
        marker.visible = false;
        intersectPoint = null;
    }
}

// --- 7. ANIMATION LOOP ---
renderer.setAnimationLoop(() => {
    // A. VR MODE
    if (renderer.xr.isPresenting) {
        handleVRRaycast();
    } 
    // B. DESKTOP / MOBILE MODE
    else {
        // 1. Calculate Movement (WASD)
        const speed = 0.05;
        let moveF = 0, moveS = 0;
        if (keyStates['KeyW'] || touchMode === 'WALK') moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            // Move relative to where the CAMERA is looking
            const fX = Math.sin(yaw);
            const fZ = Math.cos(yaw);
            const rX = Math.sin(yaw - Math.PI / 2);
            const rZ = Math.cos(yaw - Math.PI / 2);
            
            const nX = cameraRig.position.x + (fX * moveF + rX * moveS) * speed;
            const nZ = cameraRig.position.z + (fZ * moveF + rZ * moveS) * speed;

            // Collision Check
            const testPoint = new THREE.Vector3(nX, 0, nZ); // Force Y=0 for floor check
            if (!hasClipping || clippingBox.containsPoint(testPoint)) {
                cameraRig.position.x = nX;
                cameraRig.position.z = nZ;
            }
        }

        // 2. Update Camera Rotation (Look)
        // We use a "LookAt" target to prevent gimbal lock issues
        const target = new THREE.Vector3();
        target.set(
            cameraRig.position.x + Math.sin(yaw) * Math.cos(pitch),
            cameraRig.position.y + 1.6 + Math.sin(pitch), // +1.6 matches eye height
            cameraRig.position.z + Math.cos(yaw) * Math.cos(pitch)
        );
        camera.lookAt(target);
    }
    
    renderer.render(scene, camera);
});

// --- 8. LOADING ---
loader.load('./models/TeRaki-05.glb', (gltf) => {
    processModel(gltf, true);
    const loaderDiv = document.getElementById('loader');
    if(loaderDiv) {
        loaderDiv.style.opacity = '0';
        setTimeout(() => loaderDiv.style.display = 'none', 500);
    }
});
loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false));
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false));

// --- 9. EVENTS (Mouse & Touch) ---
document.addEventListener('keydown', (e) => keyStates[e.code] = true);
document.addEventListener('keyup', (e) => keyStates[e.code] = false);

document.addEventListener('click', () => { 
    if (!renderer.xr.isPresenting && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        document.body.requestPointerLock();
    }
});

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        // Limit looking up/down
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});

// Mobile Touch Logic
renderer.domElement.addEventListener('touchstart', (e) => {
    if (renderer.xr.isPresenting) return;
    e.preventDefault();
    const t = e.touches[0];
    lastTouchX = t.pageX; lastTouchY = t.pageY;
    touchMode = (t.pageX < window.innerWidth / 2) ? 'WALK' : 'LOOK';
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    if (renderer.xr.isPresenting) return;
    e.preventDefault();
    const t = e.touches[0];
    if (touchMode === 'LOOK') {
        yaw -= (t.pageX - lastTouchX) * 0.005;
        pitch -= (t.pageY - lastTouchY) * 0.005;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
    lastTouchX = t.pageX; lastTouchY = t.pageY;
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => { touchMode = null; }, { passive: false });
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});