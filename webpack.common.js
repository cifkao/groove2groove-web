const webpack = require('webpack');
const ChunksWebpackPlugin = require("chunks-webpack-plugin");

const config = {
  entry: {
    common: __dirname + '/_js/common.ts',
    demo: __dirname + '/_js/demo.ts',
  },
  output:{
    path: __dirname + '/assets/js',
    publicPath: '/assets/js',
    filename: '[name].bundle.js',
    library: 'main',
    libraryTarget: 'window',
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  plugins: [
    new webpack.ProvidePlugin({
      $: "jquery",
      jQuery: "jquery"
    }),
    new ChunksWebpackPlugin({
      outputPath: __dirname + '/_includes/webpack'
    }),
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: require.resolve('jquery'),
        use: [{
            loader: 'expose-loader',
            options: '$'
        }]
      },
    ],
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      name: false,
    },
  },
};

module.exports = config;
