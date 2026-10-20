import * as THREE from 'three';

// The colour atlas already includes indirect illumination and shadows. Keep it
// as baked radiance, and layer the PBR specular lobe over it without relighting it.
const finishes = {
    floor: { roughness: 0.30, metalness: 0, strength: 2.4, baked: 0.94 },
    wood: { roughness: 0.43, metalness: 0, strength: 0.6, baked: 0.98 },
    lacquer: { roughness: 0.23, metalness: 0, strength: 1.8, baked: 0.94 },
    stone: { roughness: 0.24, metalness: 0, strength: 1.5, baked: 0.94 },
    ceramic: { roughness: 0.16, metalness: 0, strength: 1.2, baked: 0.96 },
    metal: { roughness: 0.23, metalness: 1, strength: 0.9, baked: 0.28 },
    darkMetal: { roughness: 0.37, metalness: 0.7, strength: 0.45, baked: 0.85 },
    darkGlass: { roughness: 0.12, metalness: 0, strength: 0.9, baked: 0.92 },
    mirror: { roughness: 0.055, metalness: 1, strength: 0.95, baked: 0.02 },
    glass: { roughness: 0.12, metalness: 0, strength: 0.65, baked: 0.93 },
};
const detailLoader = new THREE.TextureLoader();
const floorNormal = detailLoader.load('./textures/floor-normal.jpg');
const floorRoughness = detailLoader.load('./textures/floor-roughness.jpg');
for (const texture of [floorNormal, floorRoughness]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.channel = 1;
}

export function prepareMaterials(root, reflections, background = false) {
    root.traverse(mesh => {
        if (!mesh.isMesh || !mesh.material || mesh.name.toLowerCase() === 'clip') return;
        const convert = source => {
            const surface = source.userData.surface || 'baked';
            if (background || surface === 'baked') {
                return new THREE.MeshBasicMaterial({ map: source.map, color: source.color,
                    side: source.side, transparent: source.transparent, opacity: source.opacity });
            }
            if (surface === 'windowGlass') {
                const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.075,
                    metalness: 0, ior: 1.5, transparent: true, opacity: 1,
                    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1 });
                // Premultiplied blending keeps physically small Fresnel reflection
                // visible while the clear portion transmits the existing scene.
                glass.premultipliedAlpha = true;
                glass.forceSinglePass = true;
                glass.userData.windowGlass = true;
                reflections.register(glass, source.userData.room, mesh);
                return glass;
            }
            const f = finishes[surface] || finishes.wood;
            const material = new THREE.MeshStandardMaterial({
                color: f.metalness === 1 ? 0xc8ccd0 : (surface === 'darkMetal' ? 0x33383d : 0xffffff),
                map: null, emissive: source.map ? 0xffffff : source.color,
                emissiveMap: source.map, emissiveIntensity: f.baked,
                roughness: f.roughness, metalness: f.metalness,
                envMapIntensity: f.strength, side: source.side,
            });
            material.name = source.name;
            material.userData.surface = surface;
            if (surface === 'floor') {
                // An independent world-space UV set leaves the baked atlas intact.
                const position = mesh.geometry.attributes.position;
                const uv = new Float32Array(position.count * 2);
                const p = new THREE.Vector3();
                for (let i=0; i<position.count; i++) {
                    p.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);
                    uv[2*i] = p.x / 2.5; uv[2*i+1] = -p.z / 2.5;
                }
                mesh.geometry.setAttribute('uv1',new THREE.BufferAttribute(uv,2));
                material.normalMap = floorNormal;
                material.normalScale.set(0.16,0.16);
                material.roughnessMap = floorRoughness;
                material.roughness = 0.6;
            }
            reflections.register(material, source.userData.room, mesh);
            return material;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    });
}
