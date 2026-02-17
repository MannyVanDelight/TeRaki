import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();

const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#e0e0e0'); 
gradient.addColorStop(1, '#444444'); 
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

// RIG HIERARCHY: Scene -> CameraRig -> Camera
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

// --- 2. STATE & GLOBALS ---
let yaw = Math.PI, pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 0, 0), yaw: Math.PI };
let clippingBox = new THREE.Box3();
let hasClipping = false;
let intersectPoint = null;
const keyStates = {};

// --- 3. LOADERS ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
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
    // Set desktop eye height, or reset VR local camera
    if (!renderer.xr.isPresenting) {
        camera.position.set(0, 1.6, 0);
    } else {
        camera.position.set(0, 0, 0);
    }
    camera.rotation.set(0,0,0);
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

function handleVRRaycast() {
    if (!controller1) return;
    const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(scene.children, true);
    const floorHit = intersects.find(hit => hit.object.userData.isFloor);

    if (floorHit) {
        marker.position.copy(floorHit.point);
        marker.visible = true;
        if (!hasClipping || clippingBox.containsPoint(floorHit.point)) {
            intersectPoint = floorHit.point;
            marker.material.color.set(0x00ff00);
        } else {
            marker.material.color.set(0xff0000);
            intersectPoint = null;
        }
    } else {
        marker.visible = false;
        intersectPoint = null;
    }
}

// --- 6. ANIMATION LOOP ---
renderer.setAnimationLoop(() => {
    if (renderer.xr.isPresenting) {
        handleVRRaycast();
    } else {
        // --- DESKTOP MOVEMENT ---
        const speed = 0.05;
        let moveF = 0, moveS = 0;
        if (keyStates['KeyW']) moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            const nX = cameraRig.position.x + (Math.sin(yaw) * moveF + Math.sin(yaw - Math.PI/2) * moveS) * speed;
            const nZ = cameraRig.position.z + (Math.cos(yaw) * moveF + Math.cos(yaw - Math.PI/2) * moveS) * speed;

            const testPoint = new THREE.Vector3(nX, 0, nZ);
            
            // Check if within clip box
            if (!hasClipping || clippingBox.containsPoint(testPoint)) {
                cameraRig.position.x = nX;
                cameraRig.position.z = nZ;
            } else {
                console.warn("Movement blocked by clip box at:", nX, nZ);
            }
        }
        
        // --- DESKTOP LOOK ---
        const target = new THREE.Vector3(
            cameraRig.position.x + Math.sin(yaw) * Math.cos(pitch),
            cameraRig.position.y + 1.6 + Math.sin(pitch),
            cameraRig.position.z + Math.cos(yaw) * Math.cos(pitch)
        );
        camera.lookAt(target);
    }
    renderer.render(scene, camera);
});

// --- 7. LOAD MODELS ---
loader.load('./models/TeRaki-05.glb', (gltf) => processModel(gltf, true));
loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false));
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false));

// --- 8. GLOBAL EVENTS ---
window.addEventListener('keydown', (e) => { 
    keyStates[e.code] = true;
    console.log("Key Pressed:", e.code); 
});

window.addEventListener('keyup', (e) => { 
    keyStates[e.code] = false; 
});

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

// Session End: Hard reset to Start object
renderer.xr.addEventListener('sessionend', () => {
    goHome();
});