import type * as THREE from 'three'

/**
 * Release GPU resources for a loaded model tree (geometries, materials, textures).
 * Safe to call after removing the object from its parent.
 * Shared materials/textures across the tree are disposed once.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) {
      mesh.geometry.dispose()
    }

    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (!material) return

    const list = Array.isArray(material) ? material : [material]
    for (const mat of list) {
      if (materials.has(mat)) continue
      materials.add(mat)
      collectTextures(mat, textures)
      mat.dispose()
    }
  })

  for (const texture of textures) {
    texture.dispose()
  }
}

function collectTextures(
  material: THREE.Material,
  textures: Set<THREE.Texture>,
): void {
  const record = material as THREE.Material & Record<string, unknown>
  for (const value of Object.values(record)) {
    if (isTexture(value)) {
      textures.add(value)
    }
  }
}

function isTexture(value: unknown): value is THREE.Texture {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isTexture' in value &&
    (value as { isTexture?: boolean }).isTexture === true
  )
}
