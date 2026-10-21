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
// Window glass look — raise these to make the panes more visible
export const GLASS = {
    reflection: 3.6,   // multiplier on the room reflection seen in the glass (1 = physically subtle)
    tint: 0.09,        // how much the glass dims the view through it (0 = invisible, 0.15 = clearly tinted)
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
                glass.userData.glassReflection = GLASS.reflection;
                glass.userData.glassTint = GLASS.tint;
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

// Re-finish only the triangles of a mesh that sit inside a world-space box (e.g. the fridge,
// which shares one lacquer mesh with the kitchen cabinets). Adds a second material group.
export function refinishInBox(root, { fromSurface, box, finish, room }, reflections) {
    const area = new THREE.Box3(new THREE.Vector3(...box[0]), new THREE.Vector3(...box[1]));
    const v = new THREE.Vector3(), c = new THREE.Vector3();
    let total = 0;
    root.traverse(mesh => {
        if (!mesh.isMesh || Array.isArray(mesh.material) || !mesh.geometry.index) return;
        if (mesh.material.userData.surface !== fromSurface) return;
        if (!new THREE.Box3().setFromObject(mesh).intersectsBox(area)) return;
        mesh.updateMatrixWorld(true);
        const g = mesh.geometry, idx = g.index.array, pos = g.attributes.position;
        const keep = [], move = [];
        for (let i = 0; i < idx.length; i += 3) {
            c.set(0, 0, 0);
            for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx[i + k]).applyMatrix4(mesh.matrixWorld));
            (area.containsPoint(c.multiplyScalar(1 / 3)) ? move : keep).push(idx[i], idx[i + 1], idx[i + 2]);
        }
        if (!move.length) return;
        const order = new idx.constructor(idx.length);
        order.set(keep); order.set(move, keep.length);
        g.setIndex(new THREE.BufferAttribute(order, 1));
        g.clearGroups(); g.addGroup(0, keep.length, 0); g.addGroup(keep.length, move.length, 1);

        const src = mesh.material;
        const m = new THREE.MeshStandardMaterial({
            color: finish.color, emissive: 0xffffff, emissiveMap: src.emissiveMap,
            emissiveIntensity: finish.baked, roughness: finish.roughness, metalness: finish.metalness,
            envMapIntensity: finish.strength, side: src.side,
        });
        m.name = src.name + ' (refinished)';
        m.userData.surface = finish.surface || 'metal';
        reflections.register(m, room, mesh);
        mesh.material = [src, m];
        total += move.length / 3;
    });
    return total;
}
