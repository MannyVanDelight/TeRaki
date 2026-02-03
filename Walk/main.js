import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();

// Sunset Gradient
const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#ffcc33'); 
gradient.addColorStop(1, '#662200'); 
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

// FOV 80 for the "Big House" feel
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.4, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. UNIFIED ROTATION ENGINE (NO ROLL EVER) ---
// Start YAW at 180 degrees (PI) so we look AT the house, not away from it
let yaw = Math.PI; 
let pitch = 0; 

function updateCameraRotation() {
    const target = new THREE.Vector3();
    const phi = THREE.MathUtils.degToRad(90 - pitch);
    const theta = yaw;
    
    // Calculate where to look based on spherical coordinates
    target.setFromSphericalCoords(1, phi, theta).add(camera.position);
    camera.lookAt(target);
}

// --- 3. INPUT HANDLING ---
const keyStates = {};
let isWalkingMobile = false;
let lastTouchX = 0;
let lastTouchY = 0;

// Desktop: Mouse Lock & Look
document.body.requestPointerLock = document.body.requestPointerLock || document.body.mozRequestPointerLock;
document.addEventListener('click', () => { document.body.requestPointerLock(); });

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch += e.movementY * 0.002;
        pitch = Math.max(-85, Math.min(85, pitch)); // Clamp Up/Down
    }
});

document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// Mobile: Split Screen Controls
renderer.domElement.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Stop Browser Zoom
    const t = e.touches[0];
    lastTouchX = t.pageX;
    lastTouchY = t.pageY;

    // Left 50% = Walk, Right 50% = Look
    if (t.pageX < window.innerWidth / 2) {
        isWalkingMobile = true;
    }
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    e.preventDefault(); 
    const t = e.touches[0];

    // Only Right Side rotates camera
    if (t.pageX > window.innerWidth / 2) {
        const dx = t.pageX - lastTouchX;
        const dy = t.pageY - lastTouchY;
        
        yaw -= dx * 0.005; 
        pitch += dy * 0.005;
        pitch = Math.max(-85, Math.min(85, pitch));
        
        lastTouchX = t.pageX;
        lastTouchY = t.pageY;
    }
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => {
    isWalkingMobile = false;
}, { passive: false });

// --- 4. MODEL LOADING ---
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

// --- 5. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);

    // 1. Calculate Forward Direction based on current Yaw
    const direction = new THREE.Vector3();
    const speed = 0.08; // Adjust speed here

    // 2. Handle Inputs
    let moveForward = 0;
    let moveSide = 0;

    // Desktop WASD
    if (keyStates['KeyW']) moveForward += 1;
    if (keyStates['KeyS']) moveForward -= 1;
    if (keyStates['KeyA']) moveSide -= 1;
    if (keyStates['KeyD']) moveSide += 1;
    
    // Mobile Walk (Left Thumb)
    if (isWalkingMobile) moveForward += 1;

    // 3. Apply Movement
    if (moveForward !== 0 || moveSide !== 0) {
        // Calculate forward vector using only YAW (ignore Pitch so we don't fly into ground)
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // Z is Cos, X is Sin
        const right = new THREE.Vector3(Math.sin(yaw - Math.PI/2), 0, Math.cos(yaw - Math.PI/2));

        camera.position.addScaledVector(forward, -moveForward * speed); // Inverted because Z is negative
        camera.position.addScaledVector(right, -moveSide * speed);
    }

    // 4. Height Controls (Q/E)
    if (keyStates['KeyE']) camera.position.y += speed;
    if (keyStates['KeyQ']) camera.position.y -= speed;

    // 5. Apply Rotation
    updateCameraRotation();

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});