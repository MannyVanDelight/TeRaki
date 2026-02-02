import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// This specific order prevents the camera from "rolling" when looking around
camera.rotation.order = 'YXZ'; 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();

// --- 2. PHYSICS & PLAYER ---
const worldOctree = new Octree();

// Capsule(start, end, radius). 
// Start is 0 (feet), End is 1.7 (eyes). Radius is 0.35 (body width)
const playerCollider = new Capsule(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.7, 0), 0.35);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();

// Adjust this spawn point to your apartment's entry coordinates
const spawnPoint = new THREE.Vector3(-2, 0, 5); 

// --- 3. CONTROLS STATE ---
const keyStates = {};
let isMovingMobile = false;

document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });
window.addEventListener('touchstart', () => { isMovingMobile = true; });
window.addEventListener('touchend', () => { isMovingMobile = false; });

// Desktop Mouse Look
document.addEventListener('mousedown', () => { document.body.requestPointerLock(); });
document.body.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        camera.rotation.y -= event.movementX * 0.002;
        camera.rotation.x -= event.movementY * 0.002;

        // Clamp vertical look to 90 degrees up/down
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        
        // HORIZON LOCK: Force Z-rotation to zero to prevent "rolling"
        camera.rotation.z = 0; 
    }
});

// --- 4. MOVEMENT CALCULATIONS ---
function getForwardVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0; // Keep movement on the horizontal plane
    playerDirection.normalize();
    return playerDirection;
}

function getSideVector() {
    camera.getWorldDirection