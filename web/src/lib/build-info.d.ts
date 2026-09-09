declare module 'virtual:makeup-build-info' {
  const info: {
    sourceHash: string
    createdAt: string
    mode: 'development' | 'production'
  }
  export default info
}
