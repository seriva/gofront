#version 300 es
in vec3 a_position;
in vec3 a_color;

uniform mat4 u_mvp;
out vec3 v_color;

void main() {
    gl_Position = u_mvp * vec4(a_position, 1.0);
    v_color = a_color;
}
