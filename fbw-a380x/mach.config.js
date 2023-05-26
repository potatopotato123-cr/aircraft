const imagePlugin = require('esbuild-plugin-inline-image');
const postCssPlugin = require('esbuild-style-plugin');
const tailwind = require('tailwindcss');
const postCssColorFunctionalNotation = require('postcss-color-functional-notation');
const postCssInset = require('postcss-inset');

/** @type { import('@synaptic-simulations/mach').MachConfig } */
module.exports = {
    packageName: 'A380X',
    packageDir: 'out/flybywire-aircraft-a380-842',
    plugins: [
        imagePlugin({ limit: -1 }),
        postCssPlugin({
            extract: true,
            postcss: {
                plugins: [
                    // transform: hsl(x y z / alpha) -> hsl(x, y, z, alpha)
                    postCssColorFunctionalNotation(),

                    // transform: inset: 0; -> top/right/left/bottom: 0;
                    postCssInset(),
                ],
            }
        }),
    ],
    instruments: [
        msfsAvionicsInstrument('MFD'),
    ],
};

function msfsAvionicsInstrument(name) {
    return {
        name,
        index: `src/systems/instruments/src/${name}/instrument.tsx`,
        simulatorPackage: {
            type: 'baseInstrument',
            templateId: `A380X_${name}`,
            mountElementId: `${name}_CONTENT`,
            fileName: name.toLowerCase(),
            imports: ['/JS/dataStorage.js'],
        },
    };
}

function reactInstrument(name, additionalImports) {
    return {
        name,
        index: `src/systems/instruments/src/${name}/index.tsx`,
        simulatorPackage: {
            type: 'react',
            isInteractive: false,
            fileName: name.toLowerCase(),
            imports: ['/JS/dataStorage.js','/JS/fbw-a380x/A380X_Simvars.js', ...(additionalImports ?? [])],
        },
    };
}
