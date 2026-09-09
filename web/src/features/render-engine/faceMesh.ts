import * as THREE from 'three'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { CANONICAL_UV, CANONICAL_VERTEX_COUNT, FACE_TRIANGLES } from './canonicalFace'

/**
 * The bridge between a photo and the shared UV space.
 *
 * Vertices sit where this photo's landmarks are; texture coordinates are the
 * canonical ones. Drawing this mesh therefore stretches anything authored in UV
 * space — a region mask, a brush stroke — onto exactly the right part of this
 * particular face, at whatever angle it was photographed.
 */
export function buildFaceGeometry(landmarks: NormalizedLandmark[]): THREE.BufferGeometry {
  const positions = new Float32Array(CANONICAL_VERTEX_COUNT * 3)

  for (let i = 0; i < CANONICAL_VERTEX_COUNT; i += 1) {
    const landmark = landmarks[i]
    // Landmarks are 0..1 from the top left; the shader draws in clip space.
    positions[i * 3] = landmark.x * 2 - 1
    positions[i * 3 + 1] = 1 - landmark.y * 2
    positions[i * 3 + 2] = 0
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(CANONICAL_UV, 2))
  geometry.setIndex(new THREE.BufferAttribute(FACE_TRIANGLES, 1))
  return geometry
}

/** Landmarks past the canonical model's 468 (the iris points) have no UV and are ignored. */
export function hasEnoughLandmarks(landmarks: NormalizedLandmark[]): boolean {
  return landmarks.length >= CANONICAL_VERTEX_COUNT
}
