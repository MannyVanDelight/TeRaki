import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();
const textureLoader = new THREE.TextureLoader();

// Load the MatCap texture
const matcapTexture = textureLoader.load('./material_look.jpg');

// Professional Grey Gradient Background
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
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

// --- 2. STATE & HOME LOGIC ---
let yaw = Math.PI; 
let pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 1.4, 8), yaw: Math.PI };
let clippingBox = new THREE.Box3(); 
let hasClipping = false;

function goHome() {
    camera.position.copy(homeData.pos);
    yaw = homeData.yaw;
    pitch = 0;
}

document.getElementById('home-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

// --- 3. INPUT HANDLING ---
const keyStates = {};
let touchMode = null; 
let lastTouchX = 0, lastTouchY = 0;

document.addEventListener('click', () => { 
    if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) document.body.requestPointerLock();
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

renderer.domElement.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    lastTouchX = t.pageX; lastTouchY = t.pageY;
    touchMode = (t.pageX < window.innerWidth / 2) ? 'WALK' : 'LOOK';
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
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

// --- 4. MODEL LOADING WITH MATCAP SWAP ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();

        // 1. Handle START position
        if (name.includes("start")) {
            homeData.pos.copy(child.getWorldPosition(new THREE.Vector3()));
            const worldQuat = child.getWorldQuaternion(new THREE.Quaternion());
            const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
            homeData.yaw = euler.y + Math.PI;
            child.visible = false; 
            return; // Skip material swap for this helper
        }

        // 2. Handle CLIP zone
        if (name.includes("clip")) {
            child.geometry.computeBoundingBox();
            clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
            child.visible = false; 
            hasClipping = true;
            return; // Skip material swap for this helper
        }
        
        // 3. APPLY MATCAP to all visible geometry
        if (child.isMesh) {
            child.material = new THREE.MeshMatcapMaterial({
                matcap: matcapTexture
            });
        }
    });
    scene.add(gltf.scene);
    goHome();

    const loaderDiv = document.getElementById('loader');
    if(loaderDiv) {
        loaderDiv.style.opacity = '0';
        setTimeout(() => loaderDiv.style.display = 'none', 500);
    }
});

// --- 5. ANIMATION & MOVEMENT ---
function updateCameraRotation() {
    const target = new THREE.Vector3();
    const forwardX = Math.sin(yaw) * Math.cos(pitch);
    const forwardY = Math.sin(pitch);
    const forwardZ = Math.cos(yaw) * Math.cos(pitch);
    target.set(camera.position.x + forwardX, camera.position.y + forwardY, camera.position.z + forwardZ);
    camera.lookAt(target);
}

function animate() {
    requestAnimationFrame(animate);
    const speed = 0.05;
    let moveForward = 0, moveSide = 0;

    if (keyStates['KeyW']) moveForward += 1;
    if (keyStates['KeyS']) moveForward -= 1;
    if (keyStates['KeyA']) moveSide -= 1;
    if (keyStates['KeyD']) moveSide += 1;
    if (touchMode === 'WALK') moveForward += 1;

    if (moveForward !== 0 || moveSide !== 0) {
        const fX = Math.sin(yaw), fZ = Math.cos(yaw);
        const rX = Math.sin(yaw - Math.PI / 2), rZ = Math.cos(yaw - Math.PI / 2);
        const nextX = camera.position.x + (fX * moveForward + rX * moveSide) * speed;
        const nextZ = camera.position.z + (fZ * moveForward + rZ * moveSide) * speed;
        const nextPos = new THREE.Vector3(nextX, camera.position.y, nextZ);

        if (!hasClipping || clippingBox.containsPoint(nextPos)) {
            camera.position.x = nextX;
            camera.position.z = nextZ;
        }
    }
    updateCameraRotation();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});