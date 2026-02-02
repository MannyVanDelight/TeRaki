import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

// Use a specific Euler order to prevent the horizon from twisting
camera.rotation.order = 'YXZ'; 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();

// --- 2. PHYSICS & PLAYER ---
const worldOctree = new Octree();

// Shrunk radius to 0.15 so you fit through tight Blender doors/geo
const playerCollider = new Capsule(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.0, 0), 0.15);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();

// --- 3. MOVEMENT & LOOK STATE ---
const keyStates = {};
let isMovingMobile = false;

// Look variables
let lon = 0; // Horizontal (Left/Right)
let lat = 0; // Vertical (Up/Down)

document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });
window.addEventListener('touchstart', () => { isMovingMobile = true; });
window.addEventListener('touchend', () => { isMovingMobile = false; });

document.addEventListener('mousedown', () => { 
    if (document.pointerLockElement !== document.body) document.body.requestPointerLock(); 
});

document.body.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        // Adjust these numbers to change mouse sensitivity
        lon -= event.movementX * 0.1; 
        lat -= event.movementY * 0.1;
        
        // Clamp vertical look so you can't flip over
        lat = Math.max(-89, Math.min(89, lat));
    }
});

// --- 4. ENGINE LOGIC ---
function updatePlayer(deltaTime) {
    // 1. Damping (Friction)
    let damping = Math.exp(-4 * deltaTime) - 1;
    playerVelocity.addScaledVector(playerVelocity, damping);

    // 2. Movement Input
    const speed = 10;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0; // Keep movement strictly horizontal
    forward.normalize();
    
    const side = new THREE.Vector3().crossVectors(camera.up, forward).normalize();

    if (keyStates['KeyW'] || isMovingMobile) playerVelocity.add(forward.multiplyScalar(speed * deltaTime));
    if (keyStates['KeyS']) playerVelocity.add(forward.multiplyScalar(-speed * deltaTime));
    if (keyStates['KeyA']) playerVelocity.add(side.multiplyScalar(speed * deltaTime));
    if (keyStates['KeyD']) playerVelocity.add(side.multiplyScalar(-speed * deltaTime));

    // 3. Collision
    const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
    playerCollider.translate(deltaPosition);

    const result = worldOctree.capsuleIntersect(playerCollider);
    if (result) {
        playerCollider.translate(result.normal.multiplyScalar(result.depth));
    }

    // 4. THE HEIGHT FIX (Manual Eye Level)
    // We place the camera exactly 1.2 meters above the bottom of the capsule
    camera.position.set(
        playerCollider.start.x,
        playerCollider.start.y + 1.2, 
        playerCollider.start.z
    );

    // 5. THE ROLL FIX (Look Logic)
    // We convert our degrees (lon/lat) into a target point for the camera to look at
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);

    const target = new THREE.Vector3();
    target.setFromSphericalCoords(1, phi, theta).add(camera.position);
    
    // lookAt forces the horizon to stay level (Up is always 0,1,0)
    camera.lookAt(target);
}

// --- 5. LOAD MODEL ---
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
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
    worldOctree.fromGraphNode(gltf.scene); 
    
    // Starting point
    playerCollider.translate(new THREE.Vector3(-2, 0, 5));
});

function animate() {
    const deltaTime = Math.min(0.05, clock.getDelta());
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