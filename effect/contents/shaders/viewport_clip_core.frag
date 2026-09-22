#version 140

uniform sampler2D sampler;
uniform vec4 viewportRect;
uniform float debugTint;
in vec2 texcoord0;
out vec4 fragColor;

void main(void)
{
    vec4 result = texture(sampler, texcoord0);
    vec2 pixel = gl_FragCoord.xy;
    bool inside = pixel.x >= viewportRect.x &&
        pixel.x < viewportRect.x + viewportRect.z &&
        pixel.y >= viewportRect.y &&
        pixel.y < viewportRect.y + viewportRect.w;
    if (debugTint > 0.5 && !inside) {
        result.rgb = mix(result.rgb, vec3(1.0, 0.0, 0.0), 0.72);
    }
    fragColor = result;
}
