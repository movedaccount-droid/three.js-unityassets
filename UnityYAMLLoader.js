import {
	BufferGeometry,
	Color,
	FileLoader,
	Float32BufferAttribute,
	Loader,
	LoaderUtils,
	MathUtils,
	Matrix3,
	Matrix4,
	Mesh,
	MeshLambertMaterial,
	MeshPhongMaterial,
	Uint16BufferAttribute,
	Vector2,
	Vector3,
	Vector4,

} from 'three';
import * as fflate from '../libs/fflate.module.js';
import { NURBSCurve } from '../curves/NURBSCurve.js';
import * as yaml from '../yaml.js'

let yamlTree;
let connections;
let sceneGraph;

class UnityYAMLLoader extends Loader {

    // construct inherited class
    // manager is a LoadingManager. usually null. used by user to specify handlers
    // for loading procedures.
    constructor(manager) {
        super(manager);        
    }

    // load function
    // called by user with reference to files.
    // returns Group of Objects of loaded assets
    load(url, onLoad, onProgress, onError) {
        
        // so we can access this in subfunctions
        const scope = this;

        // get path from parent or use our own
        const path = (scope.path === '') ? LoaderUtils.extractUrlBase(url) : scope.path;

        const fileloader = new FileLoader(this.manager);

        // boilerplate. ensure we use the same http credentials as parent etc
        fileloader.setPath(path);
        fileloader.setResponseType()
        fileloader.setRequestHeader(scope.requestHeader);
        fileloader.setWithCredentials(scope.withCredentials);

        fileloader.load(url, function(buffer) {
            // error handling for if we or the onLoad callback excepts
            try {
                onLoad(scope.parse(buffer, path));
            } catch (e) {

                if (onError) {
                    onError(e);
                } else {
                    console.error(e);
                }

                scope.manager.itemError(url);

            } 
        // TODO: if our code is too slow we may need to move this for more accurate readout   
        }, onProgress, onError);

    }

    // parses YAML mesh asset out to BufferGeometry
    parse(YAMLString, path) {

        const object = YAML.parse(YAMLString);
        console.log(this.genBuffers(object.Mesh.m_VertexData._typelessdata, object.Mesh.m_VertexData.m_Channels)[4].toString());
        
    }

    // generates hashmap of buffers from YAML channels
    genBuffers(meshTypelessData, meshChannels) {
    
        // most channels not yet identified
        const buffers = []
        for (let i = 0; i < 14; i++) {
            buffers[i] = []        
        }
        const channelsbufferslookup = {
            vertex: 0,
            normal: 1,
            tangent: 2,
            colors: 3,
            uvs: 4,
        }

        // lookup for dimensions: "count to read" and "count to skip"
        const dimensions = {
            0: [0, 0],
            1: [1, 0],
            2: [2, 0],
            3: [3, 0],
            4: [4, 0],
            52: [3, 1],
        }

        // setup readers
        const scope = this;
        const blr = new BlobReader(meshTypelessData);
        const bir = new BinaryReader(blr.getArrayBuffer());

        // lookup for formats: "function" and "size"
        const formats = {
            0: [bir.getFloat32.bind(bir), 4],
            1: [bir.getFloat16.bind(bir), 2]
        };

        // find total size of each vert in blob
        const vertsize = meshChannels.reduce((size, channel) => {
            const dimension = dimensions[channel.dimension];
            const format = formats[channel.format];
            return size += (dimension[0] + dimension[1]) * format[1];
        }, 0)

        // read channel data from blob into buffers
        meshChannels.forEach((channel, bufid) => {

            const dimension = dimensions[channel.dimension]
            const format = formats[channel.format]

            bir.seek(channel.offset);

            while (!bir.EOF()) {

                // read data for this vert
                for (let i = 0; i < dimension[0]; i++) {
                    console.log(format[0])
                    console.log(bir.getPointer())
                    const res = format[0]()
                    console.log(res)
                    buffers[bufid].push(res);        
                }

                // seek to next vert. any padding was already summed into the total vert size
                bir.skip(vertsize - format[1] * dimension[0])

            }
        });
        
        return buffers

    }

}

// reads typelessData blobs to ArrayBuffers
class BlobReader {

    constructor(blob, length) {
        this.blob = blob;
        this.length = length;
    }

    // TODO: assumes blob hex always comes in pairs.
    // so far this is true, but it'd be nice to be sure
    getArrayBuffer() {
        return new Uint8Array(
            [...this.blob].reduce((arr, hex, i) =>
                {
                    if (i % 2 == 0) {
                        arr.push(hex);
                    } else {
                        arr.push(parseInt(arr.pop() + hex, 16))
                    }
                    return arr
                }, []
            )
        ).buffer;
    }

}

class BinaryReader {

    // unityYAML always uses little endian    
    constructor(buffer) {
        this.dv = new DataView(buffer);
        this.pointer = 0;
    }

    getFloat32() {
        const float32 = this.dv.getFloat32(this.pointer, true);
        this.pointer += 4;
        return float32;
    }

    // js does not natively support these,
    // so we need to parse them ourselves.
    // see https://www.khronos.org/opengl/wiki/Small_Float_Formats
    // https://en.wikipedia.org/wiki/Half-precision_floating-point_format
    // TODO: there has tgod to be a way to do this that does not invole strings. do this in wasm maybe
    getFloat16() {
        const bits = this.getUint16().toString(2).padStart(16, "0");
        console.log(bits)

        const s = parseInt(bits[0], 2)
        const e = parseInt(bits.slice(1, 6), 2)
        const m = parseInt(bits.slice(6), 2)

        const ebd = 5
        const mbd = 10

        const emin = 0
        const emax = 31

        const mantissa = m / Math.pow(2, mbd)
        const bias = Math.pow(2, ebd - 1) - 1

        if (e == emin) {
            // handle as zero/subnormal
            return (s ? -1 : 1) * mantissa * Math.pow(2, 1 - bias)  
        } else if (e == emax) {
            // infinity or nan
            return mantissa == 0 ? (s ? -1 : 1) * Infinity : NaN
        }

        return (s ? -1 : 1) * ((1 + mantissa) * Math.pow(2, e - bias))
    }

    getUint16() {
        const uint16 = this.dv.getUint16(this.pointer, true);
        this.pointer += 2;
        return uint16;
    }

    getUint8() {
        const uint8 = this.dv.getUint8(this.pointer, true);
        this.pointer += 1;
        return uint8;
    }

    getPointer() {
        return this.pointer;
    }

    skip(bytes) {
        this.pointer += bytes;    
    }
    
    seek(byte) {
        this.pointer = byte;    
    }

    EOF() {
        return this.pointer >= this.dv.byteLength
    }

}


export { UnityYAMLLoader };
