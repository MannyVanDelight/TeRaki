import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();

// Background Gradient
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
const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace; 
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// VR Button Position Offset
const vrBtn = VRButton.createButton(renderer);
vrBtn.style.bottom = '30px';
vrBtn.style.right = '30px';
vrBtn.style.left = 'auto'; 
document.body.appendChild(vrBtn);

// --- 2. LOGIC STATE ---
let yaw = 0, pitch = 0;
const homeData = { pos: new THREE.Vector3(), yaw: 0 };
let vrFloorY = 0; 
let clippingBox = new THREE.Box3();
let hasClipping = false;

function goHome() {
    if (renderer.xr.isPresenting) {
        // VR: X and Z from 'start', Y from 'floor'
        cameraRig.position.set(homeData.pos.x, vrFloorY, homeData.pos.z);
        cameraRig.rotation.y = homeData.yaw;
    } else {
        // Desktop/Mobile: Exact coordinates from 'start'
        camera.position.copy(homeData.pos);
        cameraRig.position.set(0, 0, 0); 
        cameraRig.rotation.set(0, 0, 0);
        yaw = homeData.yaw;
        pitch = 0;
    }
}

document.getElementById('home-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

// --- 3. VR INTERACTION ---
const controllerModelFactory = new XRControllerModelFactory();
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
    if (intersectPoint && marker.visible) {
        cameraRig.position.set(intersectPoint.x, intersectPoint.y, intersectPoint.z);
    }
});
cameraRig.add(controller1);

const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
cameraRig.add(grip1);

// --- 4. ASSET LOADING ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();
        if (isMain) {
            // OBJECT A: START (Anchor for position and rotation)
            if (name.includes("start")) {
                homeData.pos.copy(child.getWorldPosition(new THREE.Vector3()));
                const worldQuat = child.getWorldQuaternion(new THREE.Quaternion());
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y;
                child.visible = false;
            }
            // OBJECT B: CLIP (Movement boundary for non-VR)
            if (name.includes("clip")) {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                if(child.material) child.material.visible = false; 
                hasClipping = true;
            }
            // OBJECT C: FLOOR (VR Height and VR Teleport target)
            if (name.includes("floor")) {
                const worldPos = child.getWorldPosition(new THREE.Vector3());
                vrFloorY = worldPos.y; 
                child.userData.isVRFloor = true;
                if(child.material) child.material.visible = false; 
            }
        }
        // Baked Texture Logic
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

// --- 5. MOVEMENT & ANIMATION ---
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

function updateCameraRotation() {
    const target = new THREE.Vector3();
    const fX = Math.sin(yaw) * Math.cos(pitch);
    const fY = Math.sin(pitch);
    const fZ = Math.cos(yaw) * Math.cos(pitch);
    target.set(camera.position.x + fX, camera.position.y + fY, camera.position.z + fZ);
    camera.lookAt(target);
}

function animate() {
    if (renderer.xr.isPresenting) {
        // VR Teleportation: Strictly raycasting against the 'floor' object
        const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        const intersects = raycaster.intersectObjects(scene.children, true);
        const validHit = intersects.find(hit => hit.object.userData.isVRFloor);
        
        if (validHit && validHit.face.normal.y > 0.5) {
            intersectPoint = validHit.point;
            marker.position.copy(intersectPoint);
            marker.visible = true;
        } else {
            marker.visible = false;
        }
    } else {
        // Desktop/Mobile Movement (0.025 speed)
        const speed = 0.025;
        let moveF = 0, moveS = 0;
        if (keyStates['KeyW'] || touchMode === 'WALK') moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1;
        if (keyStates['KeyD']) moveS += 1;

        if (moveF !== 0 || moveS !== 0) {
            const fX = Math.sin(yaw), fZ = Math.cos(yaw);
            const rX = Math.sin(yaw + Math.PI / 2), rZ = Math.cos(yaw + Math.PI / 2);
            const nX = camera.position.x + (fX * moveF + rX * moveS) * speed;
            const nZ = camera.position.z + (fZ * moveF + rZ * moveS) * speed;

            // Collision check against the 'clip' object's box
            if (!hasClipping || clippingBox.containsPoint(new THREE.Vector3(nX, camera.position.y, nZ))) {
                camera.position.x = nX;
                camera.position.z = nZ;
            }
        }
        updateCameraRotation();
    }
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

// --- 6. HANDLERS & RESIZE ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

renderer.xr.addEventListener('sessionend', () => {
    goHome();
    setTimeout(onWindowResize, 150);
});

// Input Listeners
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });
document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
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