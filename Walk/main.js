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

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);

// VR RIG: Holds the camera and controllers
const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace; 

// --- 2. VR ACTIVATION ---
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));
renderer.domElement.style.touchAction = 'none';

// --- 3. STATE & HOME LOGIC ---
let yaw = Math.PI, pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 1.4, 8), yaw: Math.PI };
let clippingBox = new THREE.Box3();
let hasClipping = false;

function goHome() {
    if (renderer.xr.isPresenting) {
        // In VR, we move the Rig
        cameraRig.position.copy(homeData.pos);
        // Reset Rig rotation if needed (optional)
        cameraRig.rotation.set(0, 0, 0);
    } else {
        // In Desktop, we move the Camera
        camera.position.copy(homeData.pos);
    }
    yaw = homeData.yaw; 
    pitch = 0;
}

document.getElementById('home-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

// --- 4. VR CONTROLLERS & TELEPORT SETUP ---
const controllerModelFactory = new XRControllerModelFactory();
const raycaster = new THREE.Raycaster();
let intersectPoint = null;

// Teleport Marker (The Ring)
const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 })
);
marker.visible = false;
scene.add(marker);

// Controller 1 (Right Hand usually)
const controller1 = renderer.xr.getController(0);
controller1.addEventListener('selectstart', () => {
    // Teleport on Trigger Pull
    if (intersectPoint && marker.visible) {
        // Move the rig to the teleport target
        cameraRig.position.set(intersectPoint.x, intersectPoint.y, intersectPoint.z);
    }
});
cameraRig.add(controller1);

// Add visual model to controller
const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
cameraRig.add(grip1);

// Add a simple guidance line to the controller
const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-5)]);
const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
controller1.add(line);

// --- 5. MODEL LOADING ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();

        if (isMain) {
            // 1. Handle Start Position
            if (name.includes("start")) {
                homeData.pos.copy(child.getWorldPosition(new THREE.Vector3()));
                const worldQuat = child.getWorldQuaternion(new THREE.Quaternion());
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y + Math.PI;
                child.visible = false;
                return;
            }
            
            // 2. Handle Clipping / Teleport Floor
            if (name.includes("clip")) {
                // Determine bounding box for Desktop WASD
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                
                // IMPORTANT: 
                // We set 'material.visible' to false so it is invisible to the eye.
                // We keep 'child.visible' true so the Raycaster can still hit it.
                if(child.material) child.material.visible = false; 
                child.userData.isClip = true; // Tag for VR Raycaster
                
                hasClipping = true;
                return;
            }
        }

        if (child.isMesh) {
            // Apply baked texture settings
            if (child.material.map) {
                child.material.emissive = new THREE.Color(0xffffff);
                child.material.emissiveMap = child.material.map;
                child.material.emissiveIntensity = 1.0; 
                child.material.color = new THREE.Color(0x000000);
            }
        }
    });
    scene.add(gltf.scene);
    if (isMain) goHome();
}

loader.load('./models/TeRaki-05.glb', (gltf) => {
    processModel(gltf, true);
    // Hide loader
    const loaderDiv = document.getElementById('loader');
    if(loaderDiv) {
        loaderDiv.style.opacity = '0';
        setTimeout(() => loaderDiv.style.display = 'none', 500);
    }
});
loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false));
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false));


// --- 6. ANIMATION & MOVEMENT LOOPS ---

// Desktop/Mobile Input State
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

function updateDesktopCamera() {
    const target = new THREE.Vector3();
    const fX = Math.sin(yaw) * Math.cos(pitch);
    const fY = Math.sin(pitch);
    const fZ = Math.cos(yaw) * Math.cos(pitch);
    target.set(camera.position.x + fX, camera.position.y + fY, camera.position.z + fZ);
    camera.lookAt(target);
}

function handleVRRaycast() {
    if (!controller1) return;

    // Set raycaster from controller position
    const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // Intersect against scene children
    const intersects = raycaster.intersectObjects(scene.children, true);

    // Find the first hit that is our "clip" object
    // We check userData.isClip OR name includes 'clip' to be safe
    const validHit = intersects.find(hit => 
        hit.object.userData.isClip || hit.object.name.toLowerCase().includes("clip")
    );

    if (validHit) {
        // Ensure we are hitting the top surface (normal pointing up)
        // This prevents teleporting to the underside or vertical walls of the clip box
        if (validHit.face.normal.y > 0.5) {
            intersectPoint = validHit.point;
            marker.position.copy(intersectPoint);
            marker.visible = true;
            marker.material.color.set(0x00ff00); // Green = Good to go
            return;
        }
    }

    // If no valid hit found
    marker.visible = false;
    intersectPoint = null;
}

function animate() {
    // 1. VR MODE
    if (renderer.xr.isPresenting) {
        handleVRRaycast();
    } 
    // 2. DESKTOP / MOBILE MODE
    else {
        const speed = 0.05;
        let moveF = 0, moveS = 0;

        if (keyStates['KeyW'] || touchMode === 'WALK') moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            const fX = Math.sin(yaw), fZ = Math.cos(yaw);
            const rX = Math.sin(yaw - Math.PI / 2), rZ = Math.cos(yaw - Math.PI / 2);
            
            const nX = camera.position.x + (fX * moveF + rX * moveS) * speed;
            const nZ = camera.position.z + (fZ * moveF + rZ * moveS) * speed;

            // Check if new position is inside the clipping box
            const testPoint = new THREE.Vector3(nX, camera.position.y, nZ);
            if (!hasClipping || clippingBox.containsPoint(testPoint)) {
                camera.position.x = nX;
                camera.position.z = nZ;
            }
        }
        updateDesktopCamera();
    }

    renderer.render(scene, camera);
}

// Start Loop
renderer.setAnimationLoop(animate);

// --- 7. DESKTOP EVENTS ---
document.addEventListener('click', () => { 
    if (!renderer.xr.isPresenting && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        document.body.requestPointerLock();
    }
});
document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// Touch Events
renderer.domElement.addEventListener('touchstart', (e) => {
    if (renderer.xr.isPresenting) return; // Ignore touch in VR
    e.preventDefault();
    const t = e.touches[0];
    lastTouchX = t.pageX; lastTouchY = t.pageY;
    touchMode = (t.pageX < window.innerWidth / 2) ? 'WALK' : 'LOOK';
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    if (renderer.xr.isPresenting) return;
    e.preventDefault();
    if (touchMode === 'LOOK') {
        const t = e.touches[0];
        yaw -= (t.pageX - lastTouchX) * 0.005;
        pitch -= (t.pageY - lastTouchY) * 0.005;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
        lastTouchX = t.pageX; lastTouchY = t.pageY;
    }
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => { touchMode = null; }, { passive: false });
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});