import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();

// RESTORED: Gradient Background
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
document.body.appendChild(VRButton.createButton(renderer));

// --- 2. STATE ---
let yaw = 0, pitch = 0;
const homeData = { pos: new THREE.Vector3(), yaw: 0 };
let vrFloorY = 0; 
let clippingBox = new THREE.Box3();
let hasClipping = false;

// Touch State
let touchMode = null;
let lastTouchX = 0, lastTouchY = 0;
let walkDirection = 0; 

function goHome() {
    if (renderer.xr.isPresenting) {
        // VR Mode: Position from Start object, Height from Floor object
        cameraRig.position.set(homeData.pos.x, vrFloorY, homeData.pos.z);
        // Rotation from Start object
        cameraRig.rotation.set(0, homeData.yaw, 0);
    } else {
        // Desktop Mode: All from Start object
        camera.position.copy(homeData.pos);
        cameraRig.position.set(0, 0, 0); 
        cameraRig.rotation.set(0, 0, 0);
        // Face 180 degrees from the wall
        yaw = homeData.yaw + Math.PI; 
        pitch = 0;
        updateCameraRotation();
    }
}

document.getElementById('home-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

// --- 3. VR & ASSETS ---
const controller1 = renderer.xr.getController(0);
const raycaster = new THREE.Raycaster();
let intersectPoint = null;

const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 })
);
marker.visible = false;
scene.add(marker);

controller1.addEventListener('selectstart', () => {
    if (intersectPoint && marker.visible) {
        cameraRig.position.set(intersectPoint.x, intersectPoint.y, intersectPoint.z);
    }
});
cameraRig.add(controller1);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        // Use exact name match to avoid hiding "KitchenFloor" etc.
        const name = child.name.toLowerCase(); 
        
        if (isMain) {
            if (name.includes("start")) {
                homeData.pos.copy(child.getWorldPosition(new THREE.Vector3()));
                const euler = new THREE.Euler().setFromQuaternion(child.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
                homeData.yaw = euler.y;
                child.visible = false;
            }
            if (name.includes("clip")) {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                if(child.material) child.material.visible = false; 
                hasClipping = true;
            }
            // STRICT CHECK: Only the object named exactly "floor" is the invisible helper
            if (name === "floor") {
                vrFloorY = child.getWorldPosition(new THREE.Vector3()).y; 
                child.userData.isVRFloor = true;
                // Only hide THIS specific floor object
                if(child.material) child.material.visible = false; 
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

loader.load('./models/TeRaki-05.glb', (gltf) => {
    processModel(gltf, true);
    document.getElementById('loader').style.display = 'none';
});
loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false));
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false));

// --- 4. MOVEMENT ENGINE ---
const keyStates = {};

function updateCameraRotation() {
    const fX = Math.sin(yaw) * Math.cos(pitch);
    const fY = Math.sin(pitch);
    const fZ = Math.cos(yaw) * Math.cos(pitch);
    camera.lookAt(camera.position.x + fX, camera.position.y + fY, camera.position.z + fZ);
}

function animate() {
    if (renderer.xr.isPresenting) {
        const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        
        // Raycast ONLY against the invisible VR helper floor
        const hit = raycaster.intersectObjects(scene.children, true).find(h => h.object.userData.isVRFloor);
        if (hit) {
            intersectPoint = hit.point; marker.position.copy(hit.point); marker.visible = true;
        } else { marker.visible = false; }
        
    } else {
        const speed = 0.025;
        let moveF = 0, moveS = 0;

        if (keyStates['KeyW']) moveF += 1;
        if (keyStates['KeyS']) moveF -= 1;
        if (keyStates['KeyA']) moveS -= 1; 
        if (keyStates['KeyD']) moveS += 1;

        if (touchMode === 'WALK') {
            moveF = walkDirection;
        }

        if (moveF !== 0 || moveS !== 0) {
            const fX = Math.sin(yaw), fZ = Math.cos(yaw);
            // FIXED: Strafe math so A is Left and D is Right
            const rX = Math.sin(yaw - Math.PI/2), rZ = Math.cos(yaw - Math.PI/2);
            
            const nX = camera.position.x + (fX * moveF + rX * moveS) * speed;
            const nZ = camera.position.z + (fZ * moveF + rZ * moveS) * speed;
            
            if (!hasClipping || clippingBox.containsPoint(new THREE.Vector3(nX, camera.position.y, nZ))) {
                camera.position.x = nX; camera.position.z = nZ;
            }
        }
        updateCameraRotation();
    }
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// --- 5. EVENT LISTENERS ---

// RESTORED: Click to capture mouse (This makes the mouse work!)
document.addEventListener('click', () => {
    if (!renderer.xr.isPresenting) {
        document.body.requestPointerLock();
    }
});

document.addEventListener('keydown', (e) => keyStates[e.code] = true);
document.addEventListener('keyup', (e) => keyStates[e.code] = false);

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});

// Mobile Touch
renderer.domElement.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    lastTouchY = t.pageY; 
    lastTouchX = t.pageX;
    touchMode = (t.pageX < window.innerWidth / 2) ? 'WALK' : 'LOOK';
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    
    if (touchMode === 'LOOK') {
        yaw -= (t.pageX - lastTouchX) * 0.005;
        pitch -= (t.pageY - lastTouchY) * 0.005;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
        lastTouchX = t.pageX;
        lastTouchY = t.pageY;
    } else if (touchMode === 'WALK') {
        const deltaY = lastTouchY - t.pageY; 
        if (deltaY > 20) walkDirection = 1;      
        else if (deltaY < -20) walkDirection = -1; 
        else walkDirection = 0;                    
    }
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => { 
    touchMode = null; 
    walkDirection = 0; 
});

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

// FIXED: Force aspect ratio reset when exiting VR
renderer.xr.addEventListener('sessionend', () => {
    goHome();
    setTimeout(onWindowResize, 100);
});