import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();

// High-end Gradient Background
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

// VR RIG (The "Feet" of the user)
const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- 2. STATE & BOUNDARIES ---
let yaw = 0, pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 0, 0), yaw: 0 };
let clippingBox = new THREE.Box3();
let hasClipping = false;

function goHome() {
    // In VR, the rig is the floor. In Desktop, we set camera height to 1.6m (eye level)
    cameraRig.position.copy(homeData.pos);
    if (!renderer.xr.isPresenting) {
        camera.position.set(0, 1.6, 0); 
    } else {
        camera.position.set(0, 0, 0);
    }
    yaw = homeData.yaw;
    pitch = 0;
}

// --- 3. VR CONTROLLERS & TELEPORT ---
const raycaster = new THREE.Raycaster();
let intersectPoint = null;

const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 })
);
marker.visible = false;
scene.add(marker);

const controller1 = renderer.xr.getController(0);
controller1.addEventListener('selectstart', () => {
    if (intersectPoint) cameraRig.position.copy(intersectPoint);
});
cameraRig.add(controller1);

const controllerModelFactory = new XRControllerModelFactory();
const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
cameraRig.add(grip1);

// --- 4. MODEL LOADING ---
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();

        if (isMain) {
            // A. START POSITION
            if (name.includes("start")) {
                child.updateMatrixWorld();
                child.getWorldPosition(homeData.pos);
                const worldQuat = new THREE.Quaternion();
                child.getWorldQuaternion(worldQuat);
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y;
                child.visible = false;
                return;
            }
            
            // B. CLIPPING BOUNDARY
            if (name.includes("clip")) {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                child.visible = false;
                hasClipping = true;
                return;
            }

            // C. TELEPORT FLOOR
            if (name.includes("floor")) {
                child.userData.isFloor = true;
            }
        }

        // Apply Baked Textures
        if (child.isMesh && child.material.map) {
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            child.material.color = new THREE.Color(0x000000);
        }
    });
    scene.add(gltf.scene);
    if (isMain) goHome();
}

loader.load('./models/TeRaki-05.glb', (gltf) => processModel(gltf, true));

// --- 5. ANIMATION & INPUT ---
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

function handleVRTeleport() {
    if (renderer.xr.isPresenting && controller1) {
        const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const intersects = raycaster.intersectObjects(scene.children, true);
        const floorHit = intersects.find(i => i.object.userData.isFloor);

        if (floorHit) {
            marker.position.copy(floorHit.point);
            marker.visible = true;
            if (hasClipping && clippingBox.containsPoint(floorHit.point)) {
                intersectPoint = floorHit.point;
                marker.material.color.set(0x00ff00);
            } else {
                intersectPoint = null;
                marker.material.color.set(0xff0000);
            }
        } else {
            marker.visible = false;
            intersectPoint = null;
        }
    }
}

function updateDesktopCamera() {
    const target = new THREE.Vector3();
    const lookAtPos = new THREE.Vector3(
        cameraRig.position.x + Math.sin(yaw) * Math.cos(pitch),
        cameraRig.position.y + camera.position.y + Math.sin(pitch),
        cameraRig.position.z + Math.cos(yaw) * Math.cos(pitch)
    );
    camera.lookAt(lookAtPos);
}

function animate() {
    if (renderer.xr.isPresenting) {
        handleVRTeleport();
    } else {
        const speed = 0.05;
        let moveF = 0, moveS = 0;
        if (keyStates['KeyW'] || touchMode === 'WALK') moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            const nX = cameraRig.position.x + (Math.sin(yaw) * moveF + Math.sin(yaw - Math.PI/2) * moveS) * speed;
            const nZ = cameraRig.position.z + (Math.cos(yaw) * moveF + Math.cos(yaw - Math.PI/2) * moveS) * speed;
            if (!hasClipping || clippingBox.containsPoint(new THREE.Vector3(nX, cameraRig.position.y, nZ))) {
                cameraRig.position.x = nX; cameraRig.position.z = nZ;
            }
        }
        updateDesktopCamera();
    }
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// --- 6. EVENTS ---
document.addEventListener('keydown', (e) => keyStates[e.code] = true);
document.addEventListener('keyup', (e) => keyStates[e.code] = false);
document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});
document.addEventListener('click', () => {
    if (!renderer.xr.isPresenting) document.body.requestPointerLock();
});
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Mobile Touch Controls
renderer.domElement.addEventListener('touchstart', (e) => {
    if (renderer.xr.isPresenting) return;
    const t = e.touches[0];
    lastTouchX = t.pageX; lastTouchY = t.pageY;
    touchMode = (t.pageX < window.innerWidth / 2) ? 'WALK' : 'LOOK';
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    if (renderer.xr.isPresenting) return;
    const t = e.touches[0];
    if (touchMode === 'LOOK') {
        yaw -= (t.pageX - lastTouchX) * 0.005;
        pitch -= (t.pageY - lastTouchY) * 0.005;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
    lastTouchX = t.pageX; lastTouchY = t.pageY;
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => touchMode = null);