/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

const path = require("path");
const merge = require("webpack-merge");
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = env => {
    const isProduction = env === "production";

    return merge({
        entry: {
            main: "./src/index.ts"
        },
        resolve: {
            extensions: [".ts", ".tsx", ".js"],
        },
        module: {
            rules: [{
                test: /\.tsx?$/,
                loader: "ts-loader"
            }]
        },
        output: {
            filename: "[name].bundle.js",
            path: path.resolve(__dirname, "dist"),
            library: "vanilla",
            // https://github.com/webpack/webpack/issues/5767
            // https://github.com/webpack/webpack/issues/7939            
            devtoolNamespace: "prague/vanilla-loader",
            libraryTarget: "umd"
        },
        devServer: {
            publicPath: '/dist'
        },
        // TODO: Take out with Jatins work on Sharepoint loader (odsp request library casues problem)
        node: {
            fs: 'empty',
            tls: 'empty',
            net: 'empty'
        },
        plugins: [
            new HtmlWebpackPlugin({
              inject: "head",
              title: "Vanilla Loader IFrame",
              template: 'src/iframe.html',
              filename: 'iframe.html'
            })
          ]
    }, isProduction
            ? require("./webpack.prod")
            : require("./webpack.dev"));
};