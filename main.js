/* L01 */ import * as THREE from 'three';
/* L02 */ import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
/* L03 */ import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
/* L04 */ import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080); 

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);

// --- 2. CONTROLS ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; 
camera.position.set(-5, 10, -7); 
controls.target.set(-0.5, -1, 0.8);
controls.update();

// --- 3. LOAD MODEL ---
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

loader.load('./models/TeRaki-05.glb', (gltf) => {
    
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            // Instead of replacing the material, we just adjust two settings:
            
            // 1. If there is a texture, make it emissive so it stays bright without lights
            if (child.material.map) {
                child.material.emissive = new THREE.Color(0xffffff);
                child.material.emissiveMap = child.material.map;
                child.material.emissiveIntensity = 1.0;
            }

            // 2. Ensure transparency is respected for windows
            child.material.transparent = true;
            child.material.alphaTest = 0.5;
            child.material.side = THREE.DoubleSide;
        }
    });

    scene.add(gltf.scene);
    console.log("Model loaded with emissive textures.");
}, undefined, (error) => {
    console.error("Loading error:", error);
});

// --- 4. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// --- 5. COORDINATE FINDER ---
setInterval(() => {
    if (camera && controls) {
        console.log("Cam:", camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
        console.log("Tar:", controls.target.x.toFixed(2), controls.target.y.toFixed(2), controls.target.z.toFixed(2));
    }
}, 2000);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});