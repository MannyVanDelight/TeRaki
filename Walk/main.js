import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();
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
let clippingBox = new THREE.Box3();
let hasClipping = false;
let intersectPoint = null;
const keyStates = {};

// --- 3. LOADERS ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

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

// --- 5. FUNCTIONS ---

function goHome() {
    cameraRig.position.copy(homeData.pos);
    yaw = homeData.yaw; 
    pitch = 0;
    camera.position.set(0, 1.6, 0); // Eye level
    camera.rotation.set(0,0,0);
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
        // VR Teleport Logic
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
        // --- DESKTOP WASD MOVEMENT ---
        const speed = 0.08;
        let moveF = 0, moveS = 0;
        
        if (keyStates['KeyW']) moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            // Forward/Back math
            const dirX = Math.sin(yaw);
            const dirZ = Math.cos(yaw);
            
            // Side/Side math (90 degrees offset)
            const sideX = Math.sin(yaw - Math.PI / 2);
            const sideZ = Math.cos(yaw - Math.PI / 2);

            const nextX = cameraRig.position.x + (dirX * moveF + sideX * moveS) * speed;
            const nextZ = cameraRig.position.z + (dirZ * moveF + sideZ * moveS) * speed;

            // SAFETY CHECK: If you are inside the box, move. 
            // If you don't have a box, move.
            const testPoint = new THREE.Vector3(nextX, 0, nextZ);
            if (!hasClipping || clippingBox.containsPoint(testPoint)) {
                cameraRig.position.x = nextX;
                cameraRig.position.z = nextZ;
            }
        }
        
        // Update Rotation
        camera.rotation.set(pitch, 0, 0);
        cameraRig.rotation.set(0, yaw, 0);
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
    if (!renderer.xr.isPresenting) document.body.requestPointerLock();
});

renderer.xr.addEventListener('sessionend', () => { goHome(); });