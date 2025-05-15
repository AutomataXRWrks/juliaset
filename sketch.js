let myShader;
let bgColor = [1.0, 1.0, 1.0]; // Default white background
let rotationX = 0;
let rotationY = 0;
let rotationZ = 0;
let cameraDistance = 3.0;

function preload() {
  const vertShader = `
    attribute vec3 aPosition;
    attribute vec2 aTexCoord;

    varying vec2 vTexCoord;

    void main() {
      vTexCoord = aTexCoord;
      vec4 positionVec4 = vec4(aPosition, 1.0);
      positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
      gl_Position = positionVec4;
    }
  `;

  const fragShader = `
    precision highp float;
    
    #define MAX_STEPS 255
    #define MIN_DISTANCE 0.001
    #define MAX_DISTANCE 10.0
    #define PI 3.14159265359
    
    uniform vec2 iResolution;
    uniform float uTimeDisplace1;
    uniform vec3 LightPosition1;
    uniform vec3 backgroundColor;
    
    // Rotation and Camera Uniforms
    uniform float RotationX;
    uniform float RotationY;
    uniform float RotationZ;
    uniform float CameraDistance;
    
    varying vec2 vTexCoord;
    
    // Color Palette Function
    vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
        return a + b * cos(6.28318 * (c * t + d));
    }
    
    // Spectrum for Iridescence
    vec3 spectrum(float n) {
        return pal(n, vec3(0.5, 0.5, 0.5), vec3(0.5, 0.5, 0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.33, 0.67));
    }
    
    // Gamma Correction
    const float GAMMA = 2.2;
    vec3 gamma(vec3 color, float g) {
        return pow(color, vec3(g));
    }
    
    vec3 linearToScreen(vec3 linearRGB) {
        return gamma(linearRGB, 1.0 / GAMMA);
    }
    
    vec4 qsqr(in vec4 a) {
        return vec4(
            a.x * a.x - a.y * a.y - a.z * a.z - a.w * a.w,
            2.0 * a.x * a.y,
            2.0 * a.x * a.z,
            2.0 * a.x * a.w
        );
    }
    
    vec4 qmul(in vec4 a, in vec4 b) {
        return vec4(
            a.x * b.x - a.y * b.y - a.z * b.z - a.w * b.w,
            a.y * b.x + a.x * b.y + a.z * b.w - a.w * b.z, 
            a.z * b.x + a.x * b.z + a.w * b.y - a.y * b.w,
            a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y
        );
    }
    
    vec4 qconj(in vec4 a) {
        return vec4(a.x, -a.yzw);
    }
    
    float qlength2(in vec4 q) {
        return dot(q, q);
    }
    
    const int numIterations = 11;
    
    // Distance Estimator for the Julia Set
    float juliaDE(in vec3 p, out vec4 oTrap, in vec4 c) {
        vec4 z = vec4(p, 0.0);
        float md2 = 1.0;
        float mz2 = dot(z, z);
    
        vec4 trap = vec4(abs(z.xyz), mz2);
    
        float n = 1.0;
        for (int i = 0; i < numIterations; i++) {
            md2 *= 4.0 * mz2;
            z = qsqr(z) + c;
    
            trap = min(trap, vec4(abs(z.xyz), dot(z, z)));
    
            mz2 = qlength2(z);
            if (mz2 > 4.0) break;
            n += 1.0;
        }
    
        oTrap = trap;
        return 0.25 * sqrt(mz2 / md2) * log(max(mz2, 1e-8));
    }
    
    // Calculate Surface Normal
    vec3 getNormal( in vec3 p, in vec4 c ) {
        vec4 z = vec4(p,0.0);
    
        // identity derivative
        vec4 J0 = vec4(1,0,0,0);
        vec4 J1 = vec4(0,1,0,0);
        vec4 J2 = vec4(0,0,1,0);
        
        for(int i=0; i<numIterations; i++) {
            vec4 cz = qconj(z);
            
            J0 = vec4( dot(J0,cz), dot(J0.xy,z.yx), dot(J0.xz,z.zx), dot(J0.xw,z.wx) );
            J1 = vec4( dot(J1,cz), dot(J1.xy,z.yx), dot(J1.xz,z.zx), dot(J1.xw,z.wx) );
            J2 = vec4( dot(J2,cz), dot(J2.xy,z.yx), dot(J2.xz,z.zx), dot(J2.xw,z.wx) );
    
            z = qsqr(z) + c; 
            
            if(qlength2(z)>4.0) break;
        }
        
        vec3 v = vec3( dot(J0,z), 
                       dot(J1,z), 
                       dot(J2,z) );
    
        return normalize( v );
    }
    
    // Apply Rotation to Point
    vec3 rotatePoint(vec3 p, vec3 angles) {
        // X-axis rotation
        mat3 rotX = mat3(
            1.0, 0.0, 0.0,
            0.0, cos(angles.x), -sin(angles.x),
            0.0, sin(angles.x), cos(angles.x)
        );
        
        // Y-axis rotation
        mat3 rotY = mat3(
            cos(angles.y), 0.0, sin(angles.y),
            0.0, 1.0, 0.0,
            -sin(angles.y), 0.0, cos(angles.y)
        );
        
        // Z-axis rotation
        mat3 rotZ = mat3(
            cos(angles.z), -sin(angles.z), 0.0,
            sin(angles.z), cos(angles.z), 0.0,
            0.0, 0.0, 1.0
        );
        
        return rotZ * rotY * rotX * p;
    }
    
    float intersect( in vec3 ro, in vec3 rd, out vec4 res, in vec4 c ) {
        vec4 tmp;
        float resT = -1.0;
        float maxd = MAX_DISTANCE;
        float h = 1.0;
        float t = 0.0;
        for( int i=0; i<300; i++ ) {
            if( h<MIN_DISTANCE||t>maxd ) break;
            h = juliaDE( ro+rd*t, tmp, c );
            t += h;
        }
        if( t<maxd ) { resT=t; res = tmp; }
        return resT;
    }
    
    // Iridescent material effect
    vec3 iridescentMaterial(vec3 rayOrigin, vec3 rayDirection, vec3 pos, vec3 normal, vec3 lightPos) {
        vec3 eyeDirection = normalize(rayOrigin - pos);
        vec3 lightDirection = normalize(lightPos - pos);
    
        // Iridescent lighting
        vec3 reflection = reflect(rayDirection, normal);
        vec3 dome = vec3(0, 1, 0);
        
        // base layer (iridescence effect)
        vec3 perturb = sin(pos * 10.0);
        vec3 color = spectrum(dot(normal + perturb * 0.01, eyeDirection) * 2.0);
        
        // specular highlights
        float specular = clamp(dot(reflection, lightDirection), 0.0, 1.0);
        specular = pow((sin(specular * 20.0 - 3.0) * 0.5 + 0.5) + 0.1, 32.0) * specular;
        specular *= 0.1;
        specular += pow(clamp(dot(reflection, lightDirection), 0.0, 1.0) + 0.3, 8.0) * 0.1;
    
        // shadow factor
        float shadow = pow(clamp(dot(normal, dome) * 0.5 + 1.2, 0.0, 1.0), 1.0);
    
        color = color * shadow + specular;
    
        return linearToScreen(color);
    }
    
    vec3 render(in vec3 ro, in vec3 rd, in vec4 c) {
        const vec3 sun = vec3(0.577, 0.577, 0.577);
        
        vec4 tra;
        vec3 col;
        float t = intersect(ro, rd, tra, c);
        
        if (t < 0.0) {
            col = backgroundColor;
        } else {
            vec3 pos = ro + t * rd;
            vec3 nor = getNormal(pos, c);
            col = iridescentMaterial(ro, rd, pos, nor, LightPosition1);
        }
    
        return pow(col, vec3(1.4545));
    }
    
    void main() {
        // Animations
        float time = uTimeDisplace1 * 0.15;
        vec4 c = 0.45 * cos(vec4(0.5, 3.9, 1.4, 1.1) + time * vec4(1.2, 1.7, 1.3, 2.5)) - vec4(0.3, 0.0, 0.0, 0.0);
    
        // Camera setup - orbit around origin
        vec3 rayOrigin = vec3(0.0, 0.0, CameraDistance);
        vec3 ta = vec3(0.0);  // Target at origin
        
        // Apply camera rotation (view angles)
        vec3 camAngles = vec3(RotationX, RotationY, RotationZ);
        rayOrigin = rotatePoint(rayOrigin, camAngles);
        
        float cr = 0.1 * cos(0.1 * time);
    
        // Render the scene
        vec3 col = vec3(0.0);
        for (int j = 0; j < 2; j++) {
            for (int i = 0; i < 2; i++) {
                vec2 p = (-iResolution.xy + 2.0 * (gl_FragCoord.xy + vec2(float(i), float(j)) / float(2))) / iResolution.y;
    
                vec3 cw = normalize(ta - rayOrigin);
                vec3 cp = vec3(sin(cr), cos(cr), 0.0); 
                vec3 cu = normalize(cross(cw, cp));
                vec3 cv = normalize(cross(cu, cw));
                vec3 rd = normalize(p.x * cu + p.y * cv + 2.0 * cw);
    
                col += render(rayOrigin, rd, c);
            }
        }
    
        col /= float(2 * 2);
    
        vec2 uv = gl_FragCoord.xy / iResolution.xy;
        col *= 1.0 + 0.9 * pow(6.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 16.0);
    
        gl_FragColor = vec4(col, 1.0);
    }
  `;
  
  myShader = createShader(vertShader, fragShader);
}

function setup() {
  createCanvas(1920, 1920, WEBGL);
  shader(myShader);
  noStroke();
  
  // Initialize with default values
  myShader.setUniform('iResolution', [width, height]);
  myShader.setUniform('uTimeDisplace1', 0.0);
  myShader.setUniform('LightPosition1', [2.0, 2.0, 2.0]);
  myShader.setUniform('backgroundColor', bgColor);
  myShader.setUniform('CameraDistance', cameraDistance);
  
  // Initial rotation
  updateRotation();
}

function draw() {
  // Update uniforms
  myShader.setUniform('iResolution', [width, height]);
  myShader.setUniform('uTimeDisplace1', millis() / 1000.0);
  myShader.setUniform('backgroundColor', bgColor);
  myShader.setUniform('CameraDistance', cameraDistance);
  
  // Handle rotation with mouse
  if (mouseIsPressed) {
    rotationY += (mouseX - pmouseX) * 0.01;
    rotationX += (mouseY - pmouseY) * 0.01;
    updateRotation();
  }
  
  // Draw a full-screen quad
  quad(-1, -1, 1, -1, 1, 1, -1, 1);
}

function updateRotation() {
  myShader.setUniform('RotationX', rotationX);
  myShader.setUniform('RotationY', rotationY);
  myShader.setUniform('RotationZ', rotationZ);
}

function mouseWheel(event) {
  // Zoom in/out with mouse wheel
  cameraDistance += event.delta * 0.01;
  cameraDistance = constrain(cameraDistance, 1.0, 10.0);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function setBackgroundColor(r, g, b) {
  bgColor = [r, g, b];
  if (myShader) {
    myShader.setUniform('backgroundColor', bgColor);
  }
}