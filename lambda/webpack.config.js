const path = require('path');
//const nodeExternals = require('webpack-node-externals');

module.exports = {
    mode: 'production',
    devtool: 'inline-source-map',
    entry: './src/index.js',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        alias: {
            "aws-sdk": path.resolve(__dirname, "node_modules/aws-sdk"),
            uuid: path.resolve(__dirname, "node_modules/uuid"),
            lodash: path.resolve(__dirname, "node_modules/lodash"),
            audiosprite: path.resolve(__dirname, "node_modules/audiosprite")
        }
    },
    optimization: {
        minimize: false
    },
    target: 'node',
    output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'commonjs2'
    },
};