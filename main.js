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
/* L12 */ document.body.appendChild(renderer.domElement);
/* L13 */ 
/* L14 */ // --- 2. LIGHTS ---
/* L15 */ const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
/* L16 */ scene.add(ambientLight);
/* L17 */ 
/* L18 */ const dirLight = new THREE.DirectionalLight(0xffffff, 2);
/* L19 */ dirLight.position.set(5, 10, 7);
/* L20 */ scene.add(dirLight);
/* L21 */ 
/* L22 */ // --- 3. CONTROLS ---
/* L23 */ const controls = new OrbitControls(camera, renderer.domElement);
/* L24 */ controls.enableDamping = true; 
/* L25 */ camera.position.set(0, 10, -9); 
/* L26 */ controls.target.set(0, 0, 0);
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
/* L36 */ loader.load(
/* L37 */     './models/TeRaki-05.glb', 
/* L38 */     (gltf) => {
/* L39 */         scene.add(gltf.scene);
/* L40 */         console.log("Compressed Model Loaded!");
/* L41 */         controls.update();
/* L42 */     },
/* L43 */     undefined,
/* L44 */     (error) => {
/* L45 */         console.error("Loader error:", error);
/* L46 */     }
/* L47 */ );
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