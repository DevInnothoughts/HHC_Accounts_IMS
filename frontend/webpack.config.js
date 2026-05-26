const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
require("dotenv").config();

module.exports = {
  entry: "./src/main.jsx",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js",
    publicPath: "/hhc/", // ✅ this line must be here
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: "babel-loader",
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./index.html",
    }),
    new webpack.DefinePlugin({
      "process.env.VITE_API_URL": JSON.stringify(
        process.env.VITE_API_URL || "http://localhost:5000/api",
      ),
    }),
  ],
  resolve: {
    extensions: [".js", ".jsx"], // ✅ needed for imports without extensions
  },
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
};
