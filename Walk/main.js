import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);

const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- 2. STATE & GLOBALS ---
let yaw = Math.PI, pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 1.4, 8), yaw: Math.PI };
let clippingBox = new THREE.Box3();
let hasClipping = false;
let intersectPoint = null;
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

// --- 3. LOADERS SETUP (MUST BE BEFORE LOADING CALLS) ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const loader = new GLTFLoader(); // This is the line that was missing or out of order
loader.setDRACOLoader(dracoLoader);

// --- 4. VR CONTROLLERS & MARKER ---
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
        cameraRig.position.set(intersectPoint.x, intersectPoint.y, intersectPoint.z);
    }
});
cameraRig.add(controller1);

const controllerModelFactory = new XRControllerModelFactory();
const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
cameraRig.add(grip1);

// --- 5. FUNCTIONS ---
function goHome() {
    if (renderer.xr.isPresenting) {
        cameraRig.position.copy(homeData.pos);
    } else {
        camera.position.copy(homeData.pos);
    }
    yaw = homeData.yaw; 
    pitch = 0;
}

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();
        if (isMain) {
            if (name.includes("start")) {
                child.updateMatrixWorld();
                child.getWorldPosition(homeData.pos);
                const worldQuat = new THREE.Quaternion();
                child.getWorldQuaternion(worldQuat);
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y + Math.PI;
                child.visible = false;
                return;
            }
            if (name.includes("clip")) {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                if(child.material) child.material.visible = false; 
                child.userData.isClip = true; 
                hasClipping = true;
                return;
            }
            if (name.includes("floor")) {
                child.userData.isFloor = true; 
                if(child.material) child.material.visible = false; // Make floor invisible
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

// --- 6. EXECUTION (ACTUALLY LOADING NOW) ---
loader.load('./models/TeRaki-05.glb', (gltf) => {
    processModel(gltf, true);
    const loaderDiv = document.getElementById('loader');
    if(loaderDiv) {
        loaderDiv.style.opacity = '0';
        setTimeout(() => loaderDiv.style.display = 'none', 500);
    }
});

// Load secondary models
loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false));
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false));

// --- 7. ANIMATION LOOP ---
renderer.setAnimationLoop(() => {
    if (renderer.xr.isPresenting) {
        handleVRRaycast();
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
            const nX = camera.position.x + (fX * moveF + rX * moveS) * speed;
            const nZ = camera.position.z + (fZ * moveF + rZ * moveS) * speed;
            const testPoint = new THREE.Vector3(nX, camera.position.y, nZ);
            if (!hasClipping || clippingBox.containsPoint(testPoint)) {
                camera.position.x = nX;
                camera.position.z = nZ;
            }
        }
        const target = new THREE.Vector3();
        target.set(camera.position.x + Math.sin(yaw) * Math.cos(pitch), camera.position.y + Math.sin(pitch), camera.position.z + Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(target);
    }
    renderer.render(scene, camera);
});

// --- 8. EVENT LISTENERS ---
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