import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock(); // Required for smooth movement

// --- 2. PHYSICS & PLAYER ---
const worldOctree = new Octree();
// Capsule(start, end, radius) - Represents a person roughly 1.7m tall
const playerCollider = new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1.35, 0), 0.35);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnGround = false;

// Spawn point (Adjust these to your entryway!)
const spawnPoint = new THREE.Vector3(-2, 1, 5); 

// --- 3. CONTROLS STATE ---
const keyStates = {};
let isMovingMobile = false;

document.addEventListener('keydown', (event) => { keyStates[event.code] = true; });
document.addEventListener('keyup', (event) => { keyStates[event.code] = false; });
window.addEventListener('touchstart', () => { isMovingMobile = true; });
window.addEventListener('touchend', () => { isMovingMobile = false; });

// Mouse look for Desktop
document.addEventListener('mousedown', () => { document.body.requestPointerLock(); });
document.body.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        camera.rotation.y -= event.movementX * 0.002;
        camera.rotation.x -= event.movementY * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
    }
});

// --- 4. MOVEMENT LOGIC ---
function getForwardVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    return playerDirection;
}

function getSideVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    playerDirection.cross(camera.up);
    return playerDirection;
}

function handleControls(deltaTime) {
    const speed = 15;
    if (keyStates['KeyW'] || isMovingMobile) playerVelocity.add(getForwardVector().multiplyScalar(speed * deltaTime));
    if (keyStates['KeyS']) playerVelocity.add(getForwardVector().multiplyScalar(-speed * deltaTime));
    if (keyStates['KeyA']) playerVelocity.add(getSideVector().multiplyScalar(-speed * deltaTime));
    if (keyStates['KeyD']) playerVelocity.add(getSideVector().multiplyScalar(speed * deltaTime));
}

function updatePlayer(deltaTime) {
    let damping = Math.exp(-4 * deltaTime) - 1;
    playerVelocity.addScaledVector(playerVelocity, damping);

    const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
    playerCollider.translate(deltaPosition);

    playerCollisions();
    camera.position.copy(playerCollider.end); // Stick camera to the head of the capsule
}

function playerCollisions() {
    const result = worldOctree.capsuleIntersect(playerCollider);
    playerOnGround = false;
    if (result) {
        playerOnGround = result.normal.y > 0;
        playerCollider.translate(result.normal.multiplyScalar(result.depth));
    }
}

// --- 5. LOAD MODEL ---
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            // Re-using your successful emissive trick
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            
            // Transparency fix
            if (child.material.map) {
                child.material.transparent = true;
                child.material.alphaTest = 0.5;
                child.material.side = THREE.DoubleSide;
            }
        }
    });

    scene.add(gltf.scene);
    worldOctree.fromGraphNode(gltf.scene); // Build collision walls from geo
    playerCollider.translate(spawnPoint);  // Move player to entrance
});

// --- 6. ANIMATION LOOP ---
function animate() {
    const deltaTime = Math.min(0.05, clock.getDelta());
    handleControls(deltaTime);
    updatePlayer(deltaTime);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});