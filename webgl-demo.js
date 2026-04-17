var cubeRotation = 0;
// will set to true when video can be copied to texture
var copyVideo = [false, false, false];

let video0;
let video1;
let video2;

let boxPositions = []; // Store box position for each canvas
const BOX_SPEED = 16; // Pixels per frame

main();

//
// Start here
//
function main() {
    const nbrOfCanvases = 3;
    for (let i = 0; i < nbrOfCanvases; i++) {
        const canvas = document.querySelector(`#glcanvas-${i}`);
        const gl = canvas.getContext("webgl");

        // If we don't have a GL context, give up now

        if (!gl) {
            alert(
                "Unable to initialize WebGL. Your browser or machine may not support it.",
            );
            return;
        }

        // Vertex shader program

        const vsSource = `
        attribute vec4 aVertexPosition;
        attribute vec3 aVertexNormal;
        attribute vec2 aTextureCoord;

        uniform mat4 uNormalMatrix;
        uniform mat4 uModelViewMatrix;
        uniform mat4 uProjectionMatrix;

        varying highp vec2 vTextureCoord;
        varying highp vec3 vLighting;

        void main(void) {
        gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
        vTextureCoord = aTextureCoord;

        // Apply lighting effect

        highp vec3 ambientLight = vec3(0.3, 0.3, 0.3);
        highp vec3 directionalLightColor = vec3(1, 1, 1);
        highp vec3 directionalVector = normalize(vec3(0.85, 0.8, 0.75));

        highp vec4 transformedNormal = uNormalMatrix * vec4(aVertexNormal, 1.0);

        highp float directional = max(dot(transformedNormal.xyz, directionalVector), 0.0);
        vLighting = ambientLight + (directionalLightColor * directional);
        }
    `;

        // Fragment shader program

        const fsSource = `
        varying highp vec2 vTextureCoord;
        varying highp vec3 vLighting;

        uniform sampler2D uSampler;

        void main(void) {
        highp vec4 texelColor = texture2D(uSampler, vTextureCoord);

        gl_FragColor = vec4(texelColor.rgb * vLighting, texelColor.a);
        }
    `;

        // Initialize a shader program; this is where all the lighting
        // for the vertices and so forth is established.
        const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

        // Collect all the info needed to use the shader program.
        // Look up which attributes our shader program is using
        // for aVertexPosition, aVertexNormal, aTextureCoord,
        // and look up uniform locations.
        const programInfo = {
            program: shaderProgram,
            attribLocations: {
                vertexPosition: gl.getAttribLocation(
                    shaderProgram,
                    "aVertexPosition",
                ),
                vertexNormal: gl.getAttribLocation(
                    shaderProgram,
                    "aVertexNormal",
                ),
                textureCoord: gl.getAttribLocation(
                    shaderProgram,
                    "aTextureCoord",
                ),
            },
            uniformLocations: {
                projectionMatrix: gl.getUniformLocation(
                    shaderProgram,
                    "uProjectionMatrix",
                ),
                modelViewMatrix: gl.getUniformLocation(
                    shaderProgram,
                    "uModelViewMatrix",
                ),
                normalMatrix: gl.getUniformLocation(
                    shaderProgram,
                    "uNormalMatrix",
                ),
                uSampler: gl.getUniformLocation(shaderProgram, "uSampler"),
            },
        };

        // Here's where we call the routine that builds all the
        // objects we'll be drawing.
        const buffers = initBuffers(gl);

        const texture = initTexture(gl);

        const video = setupVideo("Bunny.mp4", i);

        var then = 0;

        // Draw the scene repeatedly
        function render(now) {
            now *= 0.001; // convert to seconds
            const deltaTime = now - then;
            then = now;

            if (copyVideo[i]) {
                updateTexture(gl, texture, video);
            }

            drawScene(gl, programInfo, buffers, texture, deltaTime, video);
            drawAnimatedBox(gl, i);

            requestAnimationFrame(render);
        }
        requestAnimationFrame(render);
    }
}

function setupVideo(url, index) {
    const video = document.createElement("video");
    video.id = "video-id-" + index;

    if (index === 0) {
        video0 = video;
    } else if (index === 1) {
        video1 = video;
    } else if (index === 2) {
        video2 = video;
    }

    var playing = false;
    var timeupdate = false;

    video.autoplay = true;
    video.muted = true;
    video.loop = true;

    // Waiting for these 2 events ensures
    // there is data in the video

    video.addEventListener(
        "playing",
        function () {
            playing = true;
            checkReady();
        },
        true,
    );

    video.addEventListener(
        "timeupdate",
        function () {
            timeupdate = true;
            checkReady();
        },
        true,
    );

    video.src = url;
    video.play();

    function checkReady() {
        if (playing && timeupdate) {
            copyVideo[index] = true;
        }
    }

    return video;
}

function onButtonClick() {
    console.log("Button clicked");
    const canvas1 = document.getElementById("glcanvas-1");
    console.log("canvas1", canvas1);
    if (video1) {
        video1.pause();
        video1.currentTime = 0;
        video1.remove();
    }
    if (canvas1) {
        canvas1.remove();
    }
    const canvas2 = document.getElementById("glcanvas-2");
    if (video2) {
        video2.pause();
        video2.currentTime = 0;
        video2.remove();
    }
    if (canvas2) {
        canvas2.remove();
    }
}

//
// initBuffers
//
// Initialize the buffers we'll need. For this demo, we just
// have one object -- a simple three-dimensional cube.
//
function initBuffers(gl) {
    // Create a buffer for the cube's vertex positions.

    const positionBuffer = gl.createBuffer();

    // Select the positionBuffer as the one to apply buffer
    // operations to from here out.

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Now create an array of positions for the cube.

    const positions = [
        // Front face
        -2.0, -2.0, 2.0, 2.0, -2.0, 2.0, 2.0, 2.0, 2.0, -2.0, 2.0, 2.0,

        // Back face
        -1.0, -1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0,

        // Top face
        -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, -1.0,

        // Bottom face
        -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0,

        // Right face
        1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0,

        // Left face
        -1.0, -1.0, -1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0,
    ];

    // Now pass the list of positions into WebGL to build the
    // shape. We do this by creating a Float32Array from the
    // JavaScript array, then use it to fill the current buffer.

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // Set up the normals for the vertices, so that we can compute lighting.

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);

    const vertexNormals = [
        // Front
        0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,

        // Back
        0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0,

        // Top
        0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0,

        // Bottom
        0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0,

        // Right
        1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0,

        // Left
        -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0,
    ];

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(vertexNormals),
        gl.STATIC_DRAW,
    );

    // Now set up the texture coordinates for the faces.

    const textureCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);

    const textureCoordinates = [
        // Front
        0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0,
        // Back
        0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0,
        // Top
        0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0,
        // Bottom
        0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0,
        // Right
        0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0,
        // Left
        0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0,
    ];

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(textureCoordinates),
        gl.STATIC_DRAW,
    );

    // Build the element array buffer; this specifies the indices
    // into the vertex arrays for each face's vertices.

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    // This array defines each face as two triangles, using the
    // indices into the vertex array to specify each triangle's
    // position.

    const indices = [
        0,
        1,
        2,
        0,
        2,
        3, // front
        4,
        5,
        6,
        4,
        6,
        7, // back
        8,
        9,
        10,
        8,
        10,
        11, // top
        12,
        13,
        14,
        12,
        14,
        15, // bottom
        16,
        17,
        18,
        16,
        18,
        19, // right
        20,
        21,
        22,
        20,
        22,
        23, // left
    ];

    // Now send the element array to GL

    gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(indices),
        gl.STATIC_DRAW,
    );

    return {
        position: positionBuffer,
        normal: normalBuffer,
        textureCoord: textureCoordBuffer,
        indices: indexBuffer,
    };
}

//
// Initialize a texture.
//
function initTexture(gl, url) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Because video havs to be download over the internet
    // they might take a moment until it's ready so
    // put a single pixel in the texture so we can
    // use it immediately.
    const level = 0;
    const internalFormat = gl.RGBA;
    const width = 1;
    const height = 1;
    const border = 0;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    const pixel = new Uint8Array([0, 0, 255, 255]); // opaque blue
    gl.texImage2D(
        gl.TEXTURE_2D,
        level,
        internalFormat,
        width,
        height,
        border,
        srcFormat,
        srcType,
        pixel,
    );

    // Turn off mips and set  wrapping to clamp to edge so it
    // will work regardless of the dimensions of the video.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    return texture;
}

//
// copy the video texture
//
function updateTexture(gl, texture, video) {
    const level = 0;
    const internalFormat = gl.RGBA;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        level,
        internalFormat,
        srcFormat,
        srcType,
        video,
    );
}

function isPowerOf2(value) {
    return (value & (value - 1)) == 0;
}

//
// Draw the scene.
//
function drawScene(gl, programInfo, buffers, texture, deltaTime, video) {
    gl.clearColor(0.0, 0.0, 0.0, 1.0); // Clear to black, fully opaque
    gl.clearDepth(1.0); // Clear everything
    gl.enable(gl.DEPTH_TEST); // Enable depth testing
    gl.depthFunc(gl.LEQUAL); // Near things obscure far things

    // Clear the canvas before we start drawing on it.

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Create a perspective matrix, a special matrix that is
    // used to simulate the distortion of perspective in a camera.
    // Our field of view is 45 degrees, with a width/height
    // ratio that matches the display size of the canvas
    // and we only want to see objects between 0.1 units
    // and 100 units away from the camera.

    const fieldOfView = (45 * Math.PI) / 180; // in radians
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const zNear = 0.1;
    const zFar = 100.0;
    const projectionMatrix = mat4.create();

    // note: glmatrix.js always has the first argument
    // as the destination to receive the result.
    mat4.perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar);

    // Set the drawing position to the "identity" point, which is
    // the center of the scene.
    const modelViewMatrix = mat4.create();

    // Now move the drawing position a bit to where we want to
    // start drawing the square.

    mat4.translate(
        modelViewMatrix, // destination matrix
        modelViewMatrix, // matrix to translate
        [-0.0, 0.0, -6.0],
    ); // amount to translate
    mat4.rotate(
        modelViewMatrix, // destination matrix
        modelViewMatrix, // matrix to rotate
        cubeRotation, // amount to rotate in radians
        [0, 0, 1],
    ); // axis to rotate around (Z)
    mat4.rotate(
        modelViewMatrix, // destination matrix
        modelViewMatrix, // matrix to rotate
        cubeRotation * 0.7, // amount to rotate in radians
        [0, 1, 0],
    ); // axis to rotate around (X)

    const normalMatrix = mat4.create();
    mat4.invert(normalMatrix, modelViewMatrix);
    mat4.transpose(normalMatrix, normalMatrix);

    // Tell WebGL how to pull out the positions from the position
    // buffer into the vertexPosition attribute
    {
        const numComponents = 3;
        const type = gl.FLOAT;
        const normalize = false;
        const stride = 0;
        const offset = 0;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.vertexAttribPointer(
            programInfo.attribLocations.vertexPosition,
            numComponents,
            type,
            normalize,
            stride,
            offset,
        );
        gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
    }

    // Tell WebGL how to pull out the texture coordinates from
    // the texture coordinate buffer into the textureCoord attribute.
    {
        const numComponents = 2;
        const type = gl.FLOAT;
        const normalize = false;
        const stride = 0;
        const offset = 0;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.textureCoord);
        gl.vertexAttribPointer(
            programInfo.attribLocations.textureCoord,
            numComponents,
            type,
            normalize,
            stride,
            offset,
        );
        gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);
    }

    // Tell WebGL how to pull out the normals from
    // the normal buffer into the vertexNormal attribute.
    {
        const numComponents = 3;
        const type = gl.FLOAT;
        const normalize = false;
        const stride = 0;
        const offset = 0;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
        gl.vertexAttribPointer(
            programInfo.attribLocations.vertexNormal,
            numComponents,
            type,
            normalize,
            stride,
            offset,
        );
        gl.enableVertexAttribArray(programInfo.attribLocations.vertexNormal);
    }

    // Tell WebGL which indices to use to index the vertices
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

    // Tell WebGL to use our program when drawing

    gl.useProgram(programInfo.program);

    // Set the shader uniforms

    gl.uniformMatrix4fv(
        programInfo.uniformLocations.projectionMatrix,
        false,
        projectionMatrix,
    );
    gl.uniformMatrix4fv(
        programInfo.uniformLocations.modelViewMatrix,
        false,
        modelViewMatrix,
    );
    gl.uniformMatrix4fv(
        programInfo.uniformLocations.normalMatrix,
        false,
        normalMatrix,
    );

    // Specify the texture to map onto the faces.

    // Tell WebGL we want to affect texture unit 0
    gl.activeTexture(gl.TEXTURE0);

    // Bind the texture to texture unit 0
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Tell the shader we bound the texture to texture unit 0
    gl.uniform1i(programInfo.uniformLocations.uSampler, 0);

    {
        const vertexCount = 36;
        const type = gl.UNSIGNED_SHORT;
        const offset = 0;
        gl.drawElements(gl.TRIANGLES, vertexCount, type, offset);
    }

    // drawText(gl, video.currentTime);

    // Update the rotation for the next draw

    // cubeRotation += deltaTime;
}

//
// Initialize a shader program, so WebGL knows how to draw our data
//
function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    // Create the shader program

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    // If creating the shader program failed, alert

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        alert(
            "Unable to initialize the shader program: " +
                gl.getProgramInfoLog(shaderProgram),
        );
        return null;
    }

    return shaderProgram;
}

//
// creates a shader of the given type, uploads the source and
// compiles it.
//
function loadShader(gl, type, source) {
    const shader = gl.createShader(type);

    // Send the source to the shader object

    gl.shaderSource(shader, source);

    // Compile the shader program

    gl.compileShader(shader);

    // See if it compiled successfully

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert(
            "An error occurred compiling the shaders: " +
                gl.getShaderInfoLog(shader),
        );
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

function createTextTexture(
    gl,
    text,
    fontface = "Arial",
    fontsize = 24,
    textColor = "#FFFFFF",
    backgroundColor = "rgba(0,0,0,0)",
) {
    // Create a temporary canvas to draw the text
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Set canvas dimensions - adjust as needed
    canvas.width = 512;
    canvas.height = 128;

    // Clear the canvas with the background color (transparent by default)
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Configure text properties
    ctx.font = `${fontsize}px ${fontface}`;
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Draw the text
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    // Create a texture from the canvas
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Upload the canvas to the texture
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

    return {
        texture,
        width: canvas.width,
        height: canvas.height,
    };
}

function createTextQuad(gl) {
    // Create a buffer for vertex positions
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Quad vertices - same as before
    const positions = [
        -0.5,
        -0.5,
        0.0, // bottom left
        0.5,
        -0.5,
        0.0, // bottom right
        0.5,
        0.5,
        0.0, // top right
        -0.5,
        0.5,
        0.0, // top left
    ];

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // Texture coordinates - FLIPPED vertically
    const textureCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);

    const textureCoordinates = [
        0.0,
        0.0, // bottom left (CHANGED from 0.0, 1.0)
        1.0,
        0.0, // bottom right (CHANGED from 1.0, 1.0)
        1.0,
        1.0, // top right (CHANGED from 1.0, 0.0)
        0.0,
        1.0, // top left (CHANGED from 0.0, 0.0)
    ];

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(textureCoordinates),
        gl.STATIC_DRAW,
    );

    // Rest remains the same
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    const indices = [
        0,
        1,
        2, // first triangle
        0,
        2,
        3, // second triangle
    ];

    gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(indices),
        gl.STATIC_DRAW,
    );

    return {
        position: positionBuffer,
        textureCoord: textureCoordBuffer,
        indices: indexBuffer,
    };
}

function initTextShaderProgram(gl) {
    // Vertex shader for text quad
    const vsSource = `
        attribute vec4 aVertexPosition;
        attribute vec2 aTextureCoord;

        uniform mat4 uProjectionMatrix;
        uniform mat4 uModelViewMatrix;

        varying highp vec2 vTextureCoord;

        void main(void) {
            gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
            vTextureCoord = aTextureCoord;
        }
    `;

    // Fragment shader for text - simpler than the main shader since we don't need lighting
    const fsSource = `
        varying highp vec2 vTextureCoord;

        uniform sampler2D uSampler;

        void main(void) {
            gl_FragColor = texture2D(uSampler, vTextureCoord);
        }
    `;

    const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

    return {
        program: shaderProgram,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(
                shaderProgram,
                "aVertexPosition",
            ),
            textureCoord: gl.getAttribLocation(shaderProgram, "aTextureCoord"),
        },
        uniformLocations: {
            projectionMatrix: gl.getUniformLocation(
                shaderProgram,
                "uProjectionMatrix",
            ),
            modelViewMatrix: gl.getUniformLocation(
                shaderProgram,
                "uModelViewMatrix",
            ),
            uSampler: gl.getUniformLocation(shaderProgram, "uSampler"),
        },
    };
}

function drawText(gl, text) {
    // Initialize text resources for this context if needed
    if (!gl.textResources) {
        gl.textResources = {
            programInfo: initTextShaderProgram(gl),
            quad: createTextQuad(gl),
            texture: null,
            lastText: "",
        };
    }

    // Create or update text texture if text has changed for this context
    if (!gl.textResources.texture || gl.textResources.lastText !== text) {
        if (gl.textResources.texture) {
            // Delete old texture if it exists
            gl.deleteTexture(gl.textResources.texture.texture);
        }
        gl.textResources.texture = createTextTexture(gl, text);
        gl.textResources.lastText = text;
    }

    // Save WebGL state
    const depthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
    const blendEnabled = gl.isEnabled(gl.BLEND);
    let blendSrc, blendDst;

    if (blendEnabled) {
        const blendParams = gl.getParameter(gl.BLEND_SRC_ALPHA);
        blendSrc = blendParams[0];
        blendDst = blendParams[1];
    }

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const { programInfo, quad, texture } = gl.textResources;

    // Use the text shader program
    gl.useProgram(programInfo.program);

    // Create orthographic projection matrix for 2D rendering
    const projectionMatrix = mat4.create();
    mat4.ortho(
        projectionMatrix,
        0,
        gl.canvas.width,
        gl.canvas.height,
        0,
        -1,
        1,
    );

    // Position the text (center top of screen)
    const modelViewMatrix = mat4.create();
    mat4.translate(modelViewMatrix, modelViewMatrix, [
        gl.canvas.width / 2,
        50,
        0,
    ]);

    // Scale the quad to match text size
    const scale = 5; // Adjust as needed
    mat4.scale(modelViewMatrix, modelViewMatrix, [
        texture.width * scale,
        texture.height * scale,
        1.0,
    ]);

    // Set up position attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, quad.position);
    gl.vertexAttribPointer(
        programInfo.attribLocations.vertexPosition,
        3,
        gl.FLOAT,
        false,
        0,
        0,
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    // Set up texture coordinates
    gl.bindBuffer(gl.ARRAY_BUFFER, quad.textureCoord);
    gl.vertexAttribPointer(
        programInfo.attribLocations.textureCoord,
        2,
        gl.FLOAT,
        false,
        0,
        0,
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);

    // Set up indices
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad.indices);

    // Set uniforms
    gl.uniformMatrix4fv(
        programInfo.uniformLocations.projectionMatrix,
        false,
        projectionMatrix,
    );
    gl.uniformMatrix4fv(
        programInfo.uniformLocations.modelViewMatrix,
        false,
        modelViewMatrix,
    );

    // Bind text texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    gl.uniform1i(programInfo.uniformLocations.uSampler, 0);

    // Draw the text quad
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // Restore WebGL state
    if (depthTestEnabled) {
        gl.enable(gl.DEPTH_TEST);
    } else {
        gl.disable(gl.DEPTH_TEST);
    }

    if (blendEnabled) {
        gl.enable(gl.BLEND);
        gl.blendFunc(blendSrc, blendDst);
    } else {
        gl.disable(gl.BLEND);
    }
}

// Function to create and draw a colored box that animates based on time
function drawAnimatedBox(gl, index) {
    // Initialize box resources if needed
    if (!gl.boxResources) {
        gl.boxResources = {
            programInfo: initBoxShaderProgram(gl),
            buffers: createBoxBuffers(gl),
        };
    }

    // Calculate box position based on current time
    const currentTime = performance.now() / 1000; // Convert to seconds
    const duration = 2; // Time in seconds to cross the screen
    const canvasWidth = gl.canvas.width;
    const totalDistance = canvasWidth + 200; // Total distance to travel (canvas width + buffer)

    // Calculate position using time-based animation
    // This creates a repeating animation that moves from left to right
    const normalizedPosition = (currentTime / duration) % 1.0;
    const xPosition = -100 + normalizedPosition * totalDistance;

    // Save WebGL state
    const depthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
    const blendEnabled = gl.isEnabled(gl.BLEND);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const { programInfo, buffers } = gl.boxResources;

    // Use the box shader program
    gl.useProgram(programInfo.program);

    // Create orthographic projection matrix for 2D rendering
    const projectionMatrix = mat4.create();
    mat4.ortho(
        projectionMatrix,
        0,
        gl.canvas.width,
        gl.canvas.height,
        0,
        -1,
        1,
    );

    // Position the box
    const modelViewMatrix = mat4.create();
    mat4.translate(modelViewMatrix, modelViewMatrix, [
        xPosition,
        gl.canvas.height / 2,
        0,
    ]);

    // Scale the box (width and height in pixels)
    const boxWidth = 240;
    const boxHeight = 240;
    mat4.scale(modelViewMatrix, modelViewMatrix, [boxWidth, boxHeight, 1.0]);

    // Set up position attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.vertexAttribPointer(
        programInfo.attribLocations.vertexPosition,
        3,
        gl.FLOAT,
        false,
        0,
        0,
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    // Set up color attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
    gl.vertexAttribPointer(
        programInfo.attribLocations.vertexColor,
        4,
        gl.FLOAT,
        false,
        0,
        0,
    );
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexColor);

    // Set up indices
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

    // Set uniforms
    gl.uniformMatrix4fv(
        programInfo.uniformLocations.projectionMatrix,
        false,
        projectionMatrix,
    );
    gl.uniformMatrix4fv(
        programInfo.uniformLocations.modelViewMatrix,
        false,
        modelViewMatrix,
    );

    // Draw the box
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // Restore WebGL state
    if (depthTestEnabled) {
        gl.enable(gl.DEPTH_TEST);
    } else {
        gl.disable(gl.DEPTH_TEST);
    }

    if (!blendEnabled) {
        gl.disable(gl.BLEND);
    }
}

// Create box vertex buffers
function createBoxBuffers(gl) {
    // Create vertex position buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Box vertices (centered at origin)
    const positions = [
        -0.5,
        -0.5,
        0.0, // bottom left
        0.5,
        -0.5,
        0.0, // bottom right
        0.5,
        0.5,
        0.0, // top right
        -0.5,
        0.5,
        0.0, // top left
    ];

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // Create color buffer
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);

    // Colorful box (different color for each vertex)
    const colors = [
        1.0,
        0.0,
        0.0,
        1.0, // red (bottom left)
        0.0,
        1.0,
        0.0,
        1.0, // green (bottom right)
        0.0,
        0.0,
        1.0,
        1.0, // blue (top right)
        1.0,
        1.0,
        0.0,
        1.0, // yellow (top left)
    ];

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

    // Create index buffer
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    // Two triangles to form a square
    const indices = [
        0,
        1,
        2, // first triangle
        0,
        2,
        3, // second triangle
    ];

    gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(indices),
        gl.STATIC_DRAW,
    );

    return {
        position: positionBuffer,
        color: colorBuffer,
        indices: indexBuffer,
    };
}

// Initialize the box shader program
function initBoxShaderProgram(gl) {
    // Simple shader for colored box
    const vsSource = `
        attribute vec4 aVertexPosition;
        attribute vec4 aVertexColor;

        uniform mat4 uModelViewMatrix;
        uniform mat4 uProjectionMatrix;

        varying lowp vec4 vColor;

        void main(void) {
            gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
            vColor = aVertexColor;
        }
    `;

    const fsSource = `
        varying lowp vec4 vColor;

        void main(void) {
            gl_FragColor = vColor;
        }
    `;

    const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

    return {
        program: shaderProgram,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(
                shaderProgram,
                "aVertexPosition",
            ),
            vertexColor: gl.getAttribLocation(shaderProgram, "aVertexColor"),
        },
        uniformLocations: {
            projectionMatrix: gl.getUniformLocation(
                shaderProgram,
                "uProjectionMatrix",
            ),
            modelViewMatrix: gl.getUniformLocation(
                shaderProgram,
                "uModelViewMatrix",
            ),
        },
    };
}
