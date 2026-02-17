import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();

// Restore Gradient Background
const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#e0e0e0'); 
gradient.addColorStop(1, '#444444'); 
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

const cameraRig = new THREE.Group();
scene.add(cameraRig);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 0); // Desktop height
cameraRig.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- 2. STATE ---
let yaw = Math.PI, pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 0, 0), yaw: Math.PI };
let clippingBox = new THREE.Box3();
let hasClipping = false;
let intersectPoint = null;
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

// --- 3. LOADERS ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

// --- 4. VR CONTROLLERS & MODELS ---
const raycaster = new THREE.Raycaster();
const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 })
);
marker.visible = false;
scene.add(marker);

const controller1 = renderer.xr.getController(0);
controller1.addEventListener('selectstart', () => {
    if (intersectPoint && marker.visible) cameraRig.position.copy(intersectPoint);
});
cameraRig.add(controller1);

const controllerModelFactory = new XRControllerModelFactory();
const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
cameraRig.add(grip1);

// --- 5. FUNCTIONS ---
function goHome() {
    cameraRig.position.copy(homeData.pos);
    yaw = homeData.yaw; 
    pitch = 0;
    if (!renderer.xr.isPresenting) {
        camera.position.set(0, 1.6, 0);
    } else {
        camera.position.set(0, 0, 0);
    }
    // Update rotations to match the home yaw
    cameraRig.rotation.y = yaw;
    camera.rotation.x = pitch;
}

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();
        if (isMain) {
            if (name === "start") {
                child.getWorldPosition(homeData.pos);
                homeData.pos.y = 0; 
                const worldQuat = new THREE.Quaternion();
                child.getWorldQuaternion(worldQuat);
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y + Math.PI;
                child.visible = false;
                return;
            }
            if (name === "clip") {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                if(child.material) child.material.visible = false; 
                hasClipping = true;
                return;
            }
            if (name === "floor") {
                child.userData.isFloor = true; 
                if(child.material) child.material.visible = false;
                return;
            }
        }
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

// --- 6. ANIMATION LOOP ---
renderer.setAnimationLoop(() => {
    if (renderer.xr.isPresenting) {
        // VR Raycast
        const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        const intersects = raycaster.intersectObjects(scene.children, true);
        const floorHit = intersects.find(hit => hit.object.userData.isFloor);
        if (floorHit) {
            marker.position.copy(floorHit.point);
            marker.visible = true;
            intersectPoint = floorHit.point;
        } else {
            marker.visible = false;
        }
    } else {
        // --- DESKTOP/MOBILE MOVEMENT ---
        const speed = 0.05;
        let moveF = 0, moveS = 0;
        if (keyStates['KeyW'] || touchMode === 'WALK') moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            // We use the Rig's rotation for move direction
            const dirX = Math.sin(cameraRig.rotation.y);
            const dirZ = Math.cos(cameraRig.rotation.y);
            const sideX = Math.sin(cameraRig.rotation.y - Math.PI/2);
            const sideZ = Math.cos(cameraRig.rotation.y - Math.PI/2);

            const nextX = cameraRig.position.x + (dirX * moveF + sideX * moveS) * speed;
            const nextZ = cameraRig.position.z + (dirZ * moveF + sideZ * moveS) * speed;

            const testPoint = new THREE.Vector3(nextX, 0, nextZ);
            if (!hasClipping || clippingBox.containsPoint(testPoint)) {
                cameraRig.position.x = nextX;
                cameraRig.position.z = nextZ;
            }
        }
        // Sync visual rotations
        cameraRig.rotation.y = yaw;
        camera.rotation.x = pitch;
    }
    renderer.render(scene, camera);
});

// --- 7. LOAD MODELS ---
loader.load('./models/TeRaki-05.glb', (gltf) => processModel(gltf, true));
loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false));
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false));

// --- 8. EVENTS ---
window.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
window.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});

document.addEventListener('click', () => { 
    if (!renderer.xr.isPresenting && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        document.body.requestPointerLock();
    }
});

// Mobile Touch
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

renderer.domElement.addEventListener('touchend', () => { touchMode = null; });

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.xr.addEventListener('sessionend', () => { goHome(); });