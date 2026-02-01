/* L01 */ import * as THREE from 'three';
/* L02 */ import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
/* L03 */ import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
/* L04 */ import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080); // Grey background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

// CRITICAL: This makes the colors from Blender look correct
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);

// --- 2. CONTROLS ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; 

// Your Pitch-Ready Camera Position
camera.position.set(-5, 10, -7); 
controls.target.set(-0.5, -1, 0.8);
controls.update();

// --- 3. LOAD MODEL WITH DRACO ---
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();

// Point to the unzipping tools
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

loader.load('./models/TeRaki-05.glb', (gltf) => {
    
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            const m = child.material;

            // --- THE UNLIT TRICK ---
            // We set emissive to the texture map so it "glows" its own color
            if (m.map) {
                m.emissive = new THREE.Color(0xffffff); // White light
                m.emissiveMap = m.map;                  // ...filtered through your texture
                m.emissiveIntensity = 1.0; 
                
                // We darken the base color so scene lights (which we deleted) don't affect it
                m.color.set(0x000000); 
                
                // --- ALPHA / WINDOW FIX ---
                m.transparent = true;
                m.alphaTest = 0.5; 
                m.side = THREE.DoubleSide;
            }
            
            m.needsUpdate = true;
        }
    });

    scene.add(gltf.scene);
    console.log("Model Loaded & Materials Optimized");
}, 
undefined, 
(error) => {
    console.error("Error loading model:", error);
});

// --- 4. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// --- 5. WINDOW RESIZE ---
window.addEventListener('