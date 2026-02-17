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

// VR RIG SYSTEM (The 'Body' that moves in the scene)
const cameraRig = new THREE.Group();
scene.add(cameraRig);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
cameraRig.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true; // VR Enabled
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer)); // VR Button

// --- 2. STATE & HOME LOGIC ---
let yaw = Math.PI, pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 1.4, 8), yaw: Math.PI };
let clippingBox = new THREE.Box3(), hasClipping = false;
let intersectPoint = null;

function goHome() {
    // Reset the Rig position
    cameraRig.position.copy(homeData.pos);
    yaw = homeData.yaw; 
    pitch = 0;
    
    // Reset Camera local values
    if (!renderer.xr.isPresenting) {
        camera.position.set(0, 0, 0); // Reset local offset
    } else {
        camera.position.set(0, 0, 0);
    }
}

document.getElementById('home-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

// --- 3. INPUT HANDLING ---
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

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

// --- 4. VR CONTROLLERS & TELEPORT ---
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

// --- 5. MODEL LOADING ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();

        if (isMain) {
            if (name === "start") {
                child.getWorldPosition(homeData.pos);
                const worldQuat = child.getWorldQuaternion(new THREE.Quaternion());
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y + Math.PI;
                child.visible = false;
                return;
            }
            if (name === "clip") {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                child.visible = false; hasClipping = true;
                return;
            }
            // NEW: Invisible Floor Detection
            if (name === "floor") {
                child.userData.isFloor = true;
                child.visible = false; 
                return;
            }
        }

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

// --- 6. ANIMATION & MOVEMENT ---
function updateCameraRotation() {
    const target = new THREE.Vector3();
    const fX = Math.sin(yaw) * Math.cos(pitch), fY = Math.sin(pitch), fZ = Math.cos(yaw) * Math.cos(pitch);
    target.set(cameraRig.position.x + fX, cameraRig.position.y + fY, cameraRig.position.z + fZ);
    camera.lookAt(target);
}

function handleVRRaycast() {
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
}

renderer.setAnimationLoop(() => {
    if (renderer.xr.isPresenting) {
        handleVRRaycast();
    } else {
        const speed = 0.05;
        let moveF = 0, moveS = 0;
        if (keyStates['KeyW'] || touchMode === 'WALK') moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            const fX = Math.sin(yaw), fZ = Math.cos(yaw);
            const rX = Math.sin(yaw - Math.PI / 2), rZ = Math.cos(yaw - Math.PI / 2);
            const nX = cameraRig.position.x + (fX * moveF + rX * moveS) * speed;
            const nZ = cameraRig.position.z + (fZ * moveF + rZ * moveS) * speed;
            
            if (!hasClipping || clippingBox.containsPoint(new THREE.Vector3(nX, cameraRig.position.y, nZ))) {
                cameraRig.position.x = nX; cameraRig.position.z = nZ;
            }
        }
        updateCameraRotation();
    }
    renderer.render(scene, camera);
});

// --- 7. CLEANUP & VR SYNC ---
renderer.xr.addEventListener('sessionend', () => {
    goHome(); // Reset to start when leaving VR
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});