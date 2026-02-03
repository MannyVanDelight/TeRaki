import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();

// Gradient Background
const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#ffcc33'); 
gradient.addColorStop(1, '#662200'); 
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

// FOV 80
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.4, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Forces mobile browsers to respect our touch logic
renderer.domElement.style.touchAction = 'none';

// --- 2. ROTATION ENGINE ---
let yaw = Math.PI; // Start facing the house (180 degrees)
let pitch = 0; 

function updateCameraRotation() {
    const target = new THREE.Vector3();
    const forwardX = Math.sin(yaw) * Math.cos(pitch);
    const forwardY = Math.sin(pitch);
    const forwardZ = Math.cos(yaw) * Math.cos(pitch);
    
    target.set(
        camera.position.x + forwardX,
        camera.position.y + forwardY,
        camera.position.z + forwardZ
    );
    camera.lookAt(target);
}

// --- 3. INPUT HANDLING ---
const keyStates = {};
let touchMode = null; // 'WALK' or 'LOOK'
let lastTouchX = 0;
let lastTouchY = 0;

// Desktop Mouse Lock
document.body.requestPointerLock = document.body.requestPointerLock || document.body.mozRequestPointerLock;
document.addEventListener('click', () => { document.body.requestPointerLock(); });

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});

document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// --- 4. MOBILE LOGIC ---
renderer.domElement.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    lastTouchX = t.pageX;
    lastTouchY = t.pageY;

    // LEFT HALF = WALK, RIGHT HALF = LOOK
    if (t.pageX < window.innerWidth / 2) {
        touchMode = 'WALK';
    } else {
        touchMode = 'LOOK';
    }
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (touchMode === 'LOOK') {
        const t = e.touches[0];
        const dx = t.pageX - lastTouchX;
        const dy = t.pageY - lastTouchY;
        
        yaw -= dx * 0.005; 
        pitch -= dy * 0.005; 
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
        
        lastTouchX = t.pageX;
        lastTouchY = t.pageY;
    }
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => {
    touchMode = null;
}, { passive: false });

// --- 5. MODEL ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
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
});

// --- 6. ANIMATION ---
function animate() {
    requestAnimationFrame(animate);

    const speed = 0.08;
    let moveForward = 0;
    let moveSide = 0;

    // Desktop
    if (keyStates['KeyW']) moveForward += 1;
    if (keyStates['KeyS']) moveForward -= 1;
    if (keyStates['KeyA']) moveSide -= 1;
    if (keyStates['KeyD']) moveSide += 1;
    
    // Mobile (Left Thumb Hold)
    if (touchMode === 'WALK') {
        moveForward += 1;
    }

    if (moveForward !== 0 || moveSide !== 0) {
        // Calculate direction
        const forwardX = Math.sin(yaw);
        const forwardZ = Math.cos(yaw);
        const rightX = Math.sin(yaw - Math.PI/2);
        const rightZ = Math.cos(yaw - Math.PI/2);

        // FIXED: Changed '-=' to '+=' to reverse direction
        camera.position.x += (forwardX * moveForward + rightX * moveSide) * speed;
        camera.position.z += (forwardZ * moveForward + rightZ * moveSide) * speed;
    }

    // Height
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