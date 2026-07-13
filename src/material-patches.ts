import * as THREE from 'three'

/** Match emissive appearance from Home's gltfMaterialPatches.js for AR rendering. */
export function patchArMaterials(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return

    const mat = child.material
    const materials = Array.isArray(mat) ? mat : [mat]

    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue

      const name = material.name

      if (name === 'Material_0.007' || child.name === 'Mesh_0.001') {
        material.emissive.set(1, 1, 1)
        material.emissiveIntensity = 6
        material.toneMapped = false
        if (material.emissiveMap) {
          material.emissiveMap.colorSpace = THREE.SRGBColorSpace
        }
      }

      if (name === '10.6.2024_0' || child.name === 'ls-candle') {
        if (material.map) {
          material.emissiveMap = material.map
          material.emissive.set(1, 0.7, 0.35)
          material.emissiveIntensity = 0.6
        }
      }

      if (name === 'Material_0.005' || child.name === 'glowing_puppe') {
        if (material.map) {
          material.emissiveMap = material.map
          material.emissive.set(1, 0.85, 0.7)
          material.emissiveIntensity = 1.8
        }
      }

      if (name === 'Material') {
        material.emissive.set(0, 0, 0)
        material.emissiveIntensity = 1
        material.emissiveMap = null
      }

      material.needsUpdate = true
    }
  })
}
