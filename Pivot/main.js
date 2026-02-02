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
            const m = child.material;

            // 1. Find ANY texture available (Base Map or Emissive Map)
            const bakedTexture = m.map || m.emissiveMap;

            if (bakedTexture) {
                // Force the texture into both slots to be safe
                m.map = bakedTexture;
                m.emissiveMap = bakedTexture;
                m.emissive = new THREE.Color(0xffffff);
                m.emissiveIntensity = 1.0;
                
                // This is the "Light Switch" - makes it ignore scene darkness
                m.color.set(0xffffff); 
            } else {
                // If NO texture is found, make it grey so it's not pitch black
                console.warn("No texture found for:", child.name);
                m.color.set(0xcccccc);
            }

            // 2. Window Fix
            m.transparent = true;
            m.alphaTest = 0.5;
            m.side = THREE.DoubleSide;
            m.needsUpdate = true;
        }
    });

    scene.add(gltf.scene);
    console.log("Model Displayed.");
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