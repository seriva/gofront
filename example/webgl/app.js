let gl = null;
let program = null;
let uMvpLoc = null;
let mvpMatrix = new Float32Array(16);
let projMatrix = new Float32Array(16);
let viewMatrix = new Float32Array(16);
let modelMatrix = new Float32Array(16);
let rotXMatrix = new Float32Array(16);
let tmpMatrix = new Float32Array(16);
let angleX = 0.0;
let angleY = 0.0;

const vertexShaderSource = "#version 300 es\nin vec3 a_position;\nin vec3 a_color;\n\nuniform mat4 u_mvp;\nout vec3 v_color;\n\nvoid main() {\n    gl_Position = u_mvp * vec4(a_position, 1.0);\n    v_color = a_color;\n}";

const fragmentShaderSource = "#version 300 es\nprecision mediump float;\n\nin vec3 v_color;\nout vec4 fragColor;\n\nvoid main() {\n    fragColor = vec4(v_color, 1.0);\n}";

function mat4Identity(out) {
  for (let i = 0; i < 16; i++) {
    out[i] = 0;
  }
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
}

function mat4Perspective(out, fovRad, aspect, near, far) {
  for (let i = 0; i < 16; i++) {
    out[i] = 0;
  }
  let halfFov = Number(fovRad) / 2.0;
  let f = Math.fround(Number(1.0 / Math.tan(halfFov)));
  let diff = near - far;
  let nf = 1.0 / diff;
  out[0] = f / aspect;
  out[5] = f;
  let sum = far + near;
  out[10] = sum * nf;
  out[11] = -1.0;
  out[14] = 2.0 * far * near * nf;
}

function mat4Multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    let c4 = c * 4;
    for (let r = 0; r < 4; r++) {
      out[c4 + r] = a[r] * b[c4] + a[4 + r] * b[c4 + 1] + a[8 + r] * b[c4 + 2] + a[12 + r] * b[c4 + 3];
    }
  }
}

function mat4RotateX(out, src, rad) {
  let s = Math.fround(Number(Math.sin(Number(rad))));
  let c = Math.fround(Number(Math.cos(Number(rad))));
  for (let i = 0; i < 4; i++) {
    out[i] = src[i];
    out[12 + i] = src[12 + i];
  }
  out[4] = src[4] * c + src[8] * s;
  out[5] = src[5] * c + src[9] * s;
  out[6] = src[6] * c + src[10] * s;
  out[7] = src[7] * c + src[11] * s;
  out[8] = src[4] * -s + src[8] * c;
  out[9] = src[5] * -s + src[9] * c;
  out[10] = src[6] * -s + src[10] * c;
  out[11] = src[7] * -s + src[11] * c;
}

function mat4RotateY(out, src, rad) {
  let s = Math.fround(Number(Math.sin(Number(rad))));
  let c = Math.fround(Number(Math.cos(Number(rad))));
  for (let i = 0; i < 4; i++) {
    out[4 + i] = src[4 + i];
    out[12 + i] = src[12 + i];
  }
  out[0] = src[0] * c - src[8] * s;
  out[1] = src[1] * c - src[9] * s;
  out[2] = src[2] * c - src[10] * s;
  out[3] = src[3] * c - src[11] * s;
  out[8] = src[0] * s + src[8] * c;
  out[9] = src[1] * s + src[9] * c;
  out[10] = src[2] * s + src[10] * c;
  out[11] = src[3] * s + src[11] * c;
}

function mat4Translate(out, src, x, y, z) {
  for (let i = 0; i < 12; i++) {
    out[i] = src[i];
  }
  out[12] = src[0] * x + src[4] * y + src[8] * z + src[12];
  out[13] = src[1] * x + src[5] * y + src[9] * z + src[13];
  out[14] = src[2] * x + src[6] * y + src[10] * z + src[14];
  out[15] = src[3] * x + src[7] * y + src[11] * z + src[15];
}

function initShaders() {
  let vShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vShader, vertexShaderSource);
  gl.compileShader(vShader);
  let fShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fShader, fragmentShaderSource);
  gl.compileShader(fShader);
  program = gl.createProgram();
  gl.attachShader(program, vShader);
  gl.attachShader(program, fShader);
  gl.linkProgram(program);
  gl.useProgram(program);
  uMvpLoc = gl.getUniformLocation(program, "u_mvp");
}

function initGeometry() {
  let vertices = new Float32Array([-1.0, -1.0, 1.0, 0.9, 0.2, 0.2, 1.0, -1.0, 1.0, 0.9, 0.2, 0.2, 1.0, 1.0, 1.0, 0.9, 0.2, 0.2, -1.0, 1.0, 1.0, 0.9, 0.2, 0.2, 1.0, -1.0, -1.0, 0.2, 0.8, 0.3, -1.0, -1.0, -1.0, 0.2, 0.8, 0.3, -1.0, 1.0, -1.0, 0.2, 0.8, 0.3, 1.0, 1.0, -1.0, 0.2, 0.8, 0.3, -1.0, 1.0, 1.0, 0.2, 0.5, 0.9, 1.0, 1.0, 1.0, 0.2, 0.5, 0.9, 1.0, 1.0, -1.0, 0.2, 0.5, 0.9, -1.0, 1.0, -1.0, 0.2, 0.5, 0.9, -1.0, -1.0, -1.0, 0.95, 0.75, 0.2, 1.0, -1.0, -1.0, 0.95, 0.75, 0.2, 1.0, -1.0, 1.0, 0.95, 0.75, 0.2, -1.0, -1.0, 1.0, 0.95, 0.75, 0.2, 1.0, -1.0, 1.0, 0.8, 0.2, 0.8, 1.0, -1.0, -1.0, 0.8, 0.2, 0.8, 1.0, 1.0, -1.0, 0.8, 0.2, 0.8, 1.0, 1.0, 1.0, 0.8, 0.2, 0.8, -1.0, -1.0, -1.0, 0.2, 0.8, 0.8, -1.0, -1.0, 1.0, 0.2, 0.8, 0.8, -1.0, 1.0, 1.0, 0.2, 0.8, 0.8, -1.0, 1.0, -1.0, 0.2, 0.8, 0.8]);
  let indices = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23]);
  let vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  let vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  let ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  let posLoc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 24, 0);
  let colLoc = gl.getAttribLocation(program, "a_color");
  gl.enableVertexAttribArray(colLoc);
  gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, 24, 12);
}

function renderFrame(now) {
  angleX += 0.012;
  angleY += 0.018;
  mat4Identity(tmpMatrix);
  mat4RotateX(rotXMatrix, tmpMatrix, angleX);
  mat4RotateY(modelMatrix, rotXMatrix, angleY);
  mat4Identity(tmpMatrix);
  mat4Translate(viewMatrix, tmpMatrix, 0.0, 0.0, -4.5);
  mat4Multiply(tmpMatrix, viewMatrix, modelMatrix);
  mat4Multiply(mvpMatrix, projMatrix, tmpMatrix);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(uMvpLoc, false, mvpMatrix);
  gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
  requestAnimationFrame(renderFrame);
}

function main() {
  let canvas = document.getElementById("glcanvas");
  gl = canvas.getContext("webgl2");
  gl.viewport(0, 0, 600, 600);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearColor(0.05, 0.06, 0.08, 1.0);
  gl.clearDepth(1.0);
  initShaders();
  initGeometry();
  mat4Perspective(projMatrix, Math.fround(Number(Math.PI / 4.0)), 1.0, 0.1, 100.0);
  requestAnimationFrame(renderFrame);
}

main();
