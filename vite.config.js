export default ({
  optimizeDeps: {
    include: ['three'],
  },
  build: {
    commonjsOptions: {
      include: [/three/, /node_modules/],
    },
  },
})
