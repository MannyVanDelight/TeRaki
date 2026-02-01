/* L01 */ import * as THREE from 'three';
/* L02 */ import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
/* L03 */ import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
/* L04 */ import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
/* L05 */ // --- 1. SETUP ---
/* L06 */ const scene = new THREE.Scene();
/* L07 */ scene.background = new THREE.Color(0x808080); 
/* L08 */ 
/* L09 */ const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
/* L10 */ const renderer = new THREE.WebGLRenderer({ antialias: true });
/* L11 */ renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; // Ensures colors match Blender
/* L12 */ document.body.appendChild(renderer.domElement);
/* L13 */ 
/* L14 */ // --- 2. LIGHTS ---
//* L15 */ const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
//* L16 */ scene.add(ambientLight);
/* L17 */ 
//* L18 */ const dirLight = new THREE.DirectionalLight(0xffffff, 2);
//* L19 */ dirLight.position.set(5, 10, 7);
//* L20 */ scene.add(dirLight);
/* L21 */ 
/* L22 */ // --- 3. CONTROLS ---
/* L23 */ const controls = new OrbitControls(camera, renderer.domElement);
/* L24 */ controls.enableDamping = true; 
/* L25 */ camera.position.set(-5, 10, -7); 
/* L26 */ controls.target.set(-0.5, -1, 0.8);
/* L26b*/ controls.update();
/* L27 */ 
/* L28 */ // --- 4. LOAD MODEL WITH DRACO ---
/* L29 */ const loader = new GLTFLoader();
/* L30 */ 
/* L31 */ // Point to the "unzipping" tools hosted by Google
/* L32 */ const dracoLoader = new DRACOLoader();
/* L33 */ dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
/* L34 */ loader.setDRACOLoader(dracoLoader);
/* L35 */ 
/* L32 */ loader.load('./models/TeRaki-05.glb', (gltf) => {
/* L33 */     gltf.scene.traverse((child) => {
/* L34 */         if (child.isMesh) {
/* L35 */             // This makes the baked texture "self-illuminated"
/* L36 */             child.material.emissive = child.material.color;
/* L37 */             child.material.emissiveMap = child.material.map;
/* L38 */             child.material.emissiveIntensity = 1.0; 
/* L39 */         }
/* L40 */     });
/* L41 */     scene.add(gltf.scene);
/* L42 */     console.log("Baked Unlit Model Loaded!");
/* L43 */ });
/* L44 */ 
/* L45 */ // --- 5. ANIMATION LOOP ---
/* L46 */ function animate() {
/* L47 */     requestAnimationFrame(animate);
/* L48 */     controls.update();
/* L49 */     renderer.render(scene, camera);
/* L50 */ }
/* L51 */ animate();
/* L52 */ 
/* L53 */ // --- 6. COORDINATE FINDER ---
/* L54 */ setInterval(() => {
/* L55 */     if (camera && controls) {
/* L56 */         console.log("--- VIEW DATA ---");
/* L57 */         console.log("Cam:", camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
/* L58 */         console.log("Tar:", controls.target.x.toFixed(2), controls.target.y.toFixed(2), controls.target.z.toFixed(2));
/* L59 */     }
/* L60 */ }, 2000);
/* L61 */ 
/* L62 */ // Window Resize Handler
/* L63 */ window.addEventListener('resize', () => {
/* L64 */     camera.aspect = window.innerWidth / window.innerHeight;
/* L65 */     camera.updateProjectionMatrix();
/* L66 */     renderer.setSize(window.innerWidth, window.innerHeight);
/* L67 */ });