// Minimal WebGL renderer: uploads each <video> frame as a texture and draws
// a fullscreen textured quad. Mirrors the pipeline Cloud Studio uses — the
// GL canvas is what the compositor sees, which is the surface pool the
// Chrome decoder/compositor deadlock is believed to involve.

const VS_SRC = `
attribute vec2 aPos;
attribute vec2 aUV;
varying vec2 vUV;
void main() {
    vUV = aUV;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS_SRC = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
void main() {
    gl_FragColor = texture2D(uTex, vUV);
}`;

export class GLVideoRenderer {
    constructor(canvas, video) {
        this.canvas = canvas;
        this.video = video;
        this.gl = canvas.getContext("webgl", { preserveDrawingBuffer: false, antialias: false });
        if (!this.gl) throw new Error("WebGL not available");
        this.running = false;
        this.rafId = null;
        this.init();
    }

    init() {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, this.compile(gl.VERTEX_SHADER, VS_SRC));
        gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, FS_SRC));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error("program link: " + gl.getProgramInfoLog(program));
        }
        this.program = program;
        this.aPos = gl.getAttribLocation(program, "aPos");
        this.aUV = gl.getAttribLocation(program, "aUV");
        this.uTex = gl.getUniformLocation(program, "uTex");

        this.posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
            gl.STATIC_DRAW,
        );

        this.uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
        // UVs combined with UNPACK_FLIP_Y_WEBGL to render the video right-side-up.
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]),
            gl.STATIC_DRAW,
        );

        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array([0, 0, 0, 255]),
        );

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    }

    compile(type, src) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error("shader compile: " + gl.getShaderInfoLog(s));
        }
        return s;
    }

    start() {
        if (this.running) return;
        this.running = true;
        const loop = () => {
            if (!this.running) return;
            this.draw();
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    draw() {
        const gl = this.gl;
        const video = this.video;

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        if (video.readyState >= 2 && video.videoWidth > 0) {
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
            } catch (_) {
                // texImage2D can throw transiently during seeks.
            }
        }

        gl.useProgram(this.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this.uTex, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
        gl.enableVertexAttribArray(this.aPos);
        gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
        gl.enableVertexAttribArray(this.aUV);
        gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    release() {
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const gl = this.gl;
        if (this.texture) gl.deleteTexture(this.texture);
        if (this.posBuf) gl.deleteBuffer(this.posBuf);
        if (this.uvBuf) gl.deleteBuffer(this.uvBuf);
        if (this.program) gl.deleteProgram(this.program);
    }
}
