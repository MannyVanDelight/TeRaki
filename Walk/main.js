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
const ctx = canvas.getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#e0e0e0'); 
gradient.addColorStop(1, '#444444'); 
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

// RIG SYSTEM
const cameraRig = new THREE.Group();
scene.add(cameraRig);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
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
let clippingBox = new THREE.Box3(), hasClipping = false;
let intersectPoint = null;
const keyStates = {};

// --- 3. VR CONTROLLERS ---
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

// --- 4. FUNCTIONS ---
function goHome() {
    // Reset Rig to floor
    cameraRig.position.set(homeData.pos.x, 0, homeData.pos.z);
    yaw = homeData.yaw; 
    pitch = 0;

    if (!renderer.xr.isPresenting) {
        camera.position.set(0, 1.6, 0); // Desktop eye level
    } else {
        camera.position.set(0, 0, 0); // VR tracked height
    }
}

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();
        if (isMain) {
            if (name === "start") {
                child.updateMatrixWorld();
                child.getWorldPosition(homeData.pos);
                homeData.pos.y = 0;
                const worldQuat = new THREE.Quaternion();
                child.getWorldQuaternion(worldQuat);
                homeData.yaw = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ').y + Math.PI;
                child.visible = false;
            }
            if (name === "clip" && child.geometry) {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                child.visible = false; hasClipping = true;
            }
            if (name === "floor") {
                child.userData.isFloor = true;
                child.visible = false; 
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

// --- 5. LOADERS ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

loader.load('./models/TeRaki-05.glb', (gltf) => {
    processModel(gltf, true);
    const loaderDiv = document.getElementById('loader');
    if(loaderDiv) {
        loaderDiv.style.opacity = '0';
        setTimeout(() => loaderDiv.style.display = 'none', 500);
    }
}, undefined, (err) => console.error("Load Error:", err));

loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false));
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false));

// --- 6. ANIMATION LOOP ---
renderer.setAnimationLoop(() => {
    if (renderer.xr.isPresenting) {
        const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        const intersects = raycaster.intersectObjects(scene.children, true);
        const floorHit = intersects.find(hit => hit.object.userData.isFloor);
        if (floorHit) {
            marker.position.copy(floorHit.point);
            marker.visible = true;
            intersectPoint = floorHit.point;
        } else { marker.visible = false; }
    } else {
        const speed = 0.05;
        let moveF = 0, moveS = 0;
        if (keyStates['KeyW']) moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            const fX = Math.sin(yaw), fZ = Math.cos(yaw);
            const rX = Math.sin(yaw - Math.PI / 2), rZ = Math.cos(yaw - Math.PI / 2);
            const nX = cameraRig.position.x + (fX * moveF + rX * moveS) * speed;
            const nZ = cameraRig.position.z + (fZ * moveF + rZ * moveS) * speed;
            
            if (!hasClipping || clippingBox.containsPoint(new THREE.Vector3(nX, 0.5, nZ))) {
                cameraRig.position.x = nX; cameraRig.position.z = nZ;
            }
        }
        camera.rotation.set(pitch, 0, 0);
        cameraRig.rotation.set(0, yaw, 0);
    }
    renderer.render(scene, camera);
});

// --- 7. EVENTS ---
window.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
window.addEventListener('keyup', (e) => { keyStates[e.code] = false; });
document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});
document.addEventListener('mousedown', () => { 
    if (!renderer.xr.isPresenting) document.body.requestPointerLock();
});

renderer.xr.addEventListener('sessionstart', () => {
    camera.position.set(0, 0, 0); 
    cameraRig.position.y = 0; 
});
renderer.xr.addEventListener('sessionend', () => { goHome(); });

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});