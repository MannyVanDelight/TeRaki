import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- 1. SETUP ---
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

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);

let yaw = Math.PI; 
let pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 1.4, 8), yaw: Math.PI };
let clippingBox = new THREE.Box3(); // To store the 'clip' object boundaries
let hasClipping = false;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

function goHome() {
    camera.position.copy(homeData.pos);
    yaw = homeData.yaw;
    pitch = 0;
}

document.getElementById('home-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

function updateCameraRotation() {
    const target = new THREE.Vector3();
    const forwardX = Math.sin(yaw) * Math.cos(pitch);
    const forwardY = Math.sin(pitch);
    const forwardZ = Math.cos(yaw) * Math.cos(pitch);
    target.set(camera.position.x + forwardX, camera.position.y + forwardY, camera.position.z + forwardZ);
    camera.lookAt(target);
}

// --- 3. INPUTS ---
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

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

// --- 4. MOBILE ---
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

// --- 5. MODEL LOADING ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        // Find Start Position
        if (child.name.toLowerCase().includes("start")) {
            homeData.pos.copy(child.getWorldPosition(new THREE.Vector3()));
            const worldQuat = child.getWorldQuaternion(new THREE.Quaternion());
            const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
            homeData.yaw = euler.y + Math.PI;
            child.visible = false; 
        }

        // FIND CLIPPING OBJECT
        if (child.name.toLowerCase().includes("clip")) {
            child.geometry.computeBoundingBox();
            clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
            child.visible = false; // Make it invisible as requested
            hasClipping = true;
        }
        
        if (child.isMesh) {
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            if (child.material.map) {
                child.material.transparent = true;
                child.material.alphaTest = 0.5;
                child.material.side = THREE.DoubleSide;
            }
        }
    });
    scene.add(gltf.scene);
    goHome();

    const loaderDiv = document.getElementById('loader');
    if(loaderDiv) { loaderDiv.style.opacity = '0'; setTimeout(() => loaderDiv.style.display = 'none', 500); }
});

// --- 6. ANIMATION ---
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
        const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
        const rightX = Math.sin(yaw - Math.PI/2), rightZ = Math.cos(yaw - Math.PI/2);
        
        // Calculate Potential New Position
        const nextX = camera.position.x + (forwardX * moveForward + rightX * moveSide) * speed;
        const nextZ = camera.position.z + (forwardZ * moveForward + rightZ * moveSide) * speed;
        
        const nextPos = new THREE.Vector3(nextX, camera.position.y, nextZ);

        // ONLY MOVE IF NOT INSIDE THE CLIP BOX
        if (!hasClipping || !clippingBox.containsPoint(nextPos)) {
            camera.position.x = nextX;
            camera.position.z = nextZ;
        }
    }
    
    if (keyStates['KeyE']) camera.position.y += speed;
    if (keyStates['KeyQ']) camera.position.y -= speed;

    updateCameraRotation();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});