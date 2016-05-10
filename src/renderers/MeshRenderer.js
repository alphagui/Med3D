/**
 * Created by Primoz on 28.4.2016.
 */

M3D.MeshRenderer = class {

    constructor (canvas, gl_version) {
        // Create new gl manager with appropriate version
        this._glManager = new M3D.GLManager(canvas, gl_version);

        // Retrieve context from gl manager
        this._gl = this._glManager.context;

        // Current program
        this._loadingPrograms = false;
        this._shaderLoader = new M3D.ShaderLoader();
        this._programFetcher = new M3D.GLPrograms(this._gl);

        // Throw error if the gl context could not be retrieved
        if (!this._gl) {
            throw 'Something went wrong while initializing WebGL context.'
        }

        //region Current frame render arrays
        this._opaqueObjects = [];
        this._transparentObjects = [];
        this._lights = [];
        this._lightsCombined = {
            hash: '',
            ambient: [0, 0, 0],
            directional: [],
            point: []
        };
        // endregion

        //region Helper objects
        this._properties = new M3D.GLProperties();
        this._attributeManager = new M3D.GLAttributeManager(this._gl, this._properties);
        //endregion

        //region Execution values
        this._autoClear = true;
        //endregion

        // Initialize default GL state
        this._gl.viewport(0, 0, canvas.width, canvas.height);
        // Enable depth testing by default
        this._gl.enable(this._gl.DEPTH_TEST);
        this._gl.depthFunc(this._gl.LEQUAL);

        // Enable back-face culling by default
        this._gl.enable(this._gl.CULL_FACE);
        this._gl.frontFace(this._gl.CCW);
        //this._gl.cullFace(this._gl.BACK);

        this._gl.disable(this._gl.BLEND);
    }


    render (scene, camera) {

        // Check if all of the required programs are loaded
        if (!this._loadPrograms(scene)) {
            return;
        }

        // Check if correct object instance was passed as camera
        if (camera instanceof M3D.Camera === false) {
            console.error(LOGTAG + "Given camera is not an instance of M3D.Camera");
            return;
        }

        // Update scene graph and camera matrices
        if (scene.autoUpdate === true)
            scene.updateMatrixWorld();

        // If camera is not part of the scene.. Update its worldMatrix anyways
        if (camera.parent === null)
            camera.updateMatrixWorld();

        camera.matrixWorldInverse.getInverse(camera.matrixWorld);

        // Clear the render arrays
        this._opaqueObjects.length = 0;
        this._transparentObjects.length = 0;
        this._lights.length = 0;

        // Update objects attributes and setup lights
        this._projectObject(scene, camera);

        this._setupLights(this._lights, camera);

        // Clear color, depth and stencil buffer
        if (this._glManager.autoClear) {
            this._glManager.clear(true, true, true);
        }

        // Render opaque objects
        this._renderObjects(this._opaqueObjects, camera);
    }

    _loadPrograms(scene) {
        // Check if all of the required programs are loaded
        if (scene.programsDirty) {

            if (!this._loadingPrograms) {
                this._loadingPrograms = true;

                // Store self reference for inner function
                var self = this;

                // Called after download finishes
                var onShaderLoad = function (noErrors) {
                    if (!noErrors) {
                        throw "Errors occurred during the shader loading.";
                    }

                    // Compile and link new programs
                    for (var i = 0; i < scene.requiredPrograms.length; i++) {
                        if (scene.requiredPrograms[i].program === undefined)
                            self._glManager.setupProgram(scene.requiredPrograms[i]);
                    }

                    // Mark loading finished and scene not dirty
                    self._loadingPrograms = false;
                    scene.setProgramsNotDirty();
                };

                this._shaderLoader.loadProgramsSources(scene.requiredPrograms, onShaderLoad)
            }
            return false;
        }

        return true;
    }

    _renderObjects(objects, camera) {

        for (var i = 0; i < objects.length; i++) {

            var program = objects[i].material.program.program;

            this._gl.useProgram(program);

            this._setup_uniforms(program, objects[i], camera);

            var positions = objects[i].geometry.attributes.position;

            this._setup_attributes(program, objects[i], positions);

            this._gl.drawArrays(this._gl.TRIANGLES, 0, positions.count);
        }

    }

    _setup_attributes (program, object, positions) {
        var attributeSetter = program.attributesSetter;

        var noError = true;

        var attributes = Object.getOwnPropertyNames(attributeSetter);

        // Set all of the properties
        for (var i = 0; i < attributes.length; i++) {
            switch (attributes[i]) {
                case "VPos":
                    var buffer = this._attributeManager.getAttributeBuffer(positions);
                    attributeSetter["VPos"].set(buffer, 3);
                    break;
                case "PNorm":
                    var normal = object.geometry.attributes.normal;
                    var buffer = this._attributeManager.getAttributeBuffer(normal);
                    attributeSetter["PNorm"].set(buffer, 3);
                    break;
                default:
                    console.error("Unknown Attribute!");
                    noError = false;
                    break;
            }
        }
    }

    _setup_uniforms (program, object, camera) {
        var uniformSetter = program.uniformSetter;

        var noError = true;

        var uniforms = Object.getOwnPropertyNames(uniformSetter);

        // Set all of the properties
        for (var i = 0; i < uniforms.length; i++) {
            switch (uniforms[i]) {
                case "PMat":
                    uniformSetter["PMat"].set(camera.projectionMatrix.elements);
                    break;
                case "MVMat":
                    uniformSetter["MVMat"].set(object.modelViewMatrix.elements);
                    break;
                case "NMat":
                    var mat = new THREE.Matrix4();
                    uniformSetter["NMat"].set(mat.elements);
                    break;
                default:
                    console.error("Unknown uniform!");
                    noError = false;
                    break;
            }
        }

        return noError;
    }

    _projectObject(object, camera) {
        //TODO:: Add frustum culling

        // If object is not visible do not bother projecting it
        if (object.visible === false)
            return;

        // If the object is light push it to light cache array
        if (object instanceof M3D.Light) {
            this._lights.push(object);
        }
        // If the object is mesh and it's visible. Update it's attributes.
        else if ( object instanceof  M3D.Mesh ) {
            if ( object.material.visible === true ) {
                // Updates or derives attributes from the WebGL geometry
                object.geometry = this._attributeManager.updateAttributes(object);

                // Derive mv and normal matrices
                object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
                object.normalMatrix.getNormalMatrix(object.modelViewMatrix);

                // Add object to correct render array
                if (object.material.transparent) {
                    this._transparentObjects.push(object);
                }
                else {
                    this._opaqueObjects.push(object);
                }
            }
        }
        // Scene is only an abstract representation
        else if (!(object instanceof M3D.Scene)) {
            //console.log("MeshRenderer: Received unsupported object type")
        }

        // Recursively descend through children and project them
        var children = object.children;

        // Recurse through the children
        for ( var i = 0, l = children.length; i < l; i ++ ) {
            this._projectObject( children[ i ], camera );
        }
    }

    /**
     * Sets up all of the lights found during the object projections. The lights are summed up into a single lights structure
     * representing all of the lights that affect the scene in the current frame.
     * @param {Array} lights Array of lights that were found during the projection
     * @param {M3D.Camera} camera Camera observing the scene
     */
    _setupLights(lights, camera) {

        // Light properties
        var light,
            color,
            intensity,
            distance;

        // Light colors
        var r = 0, g = 0, b = 0;

        // Number of directional lights in the scene
        var directionalLength = 0;
        // Number of point lights in the scene
        var pointLength = 0;

        for (var i = 0; i < lights.length; i++) {

            light = lights[i];

            color = light.color;
            intensity = light.intensity;
            distance = light.distance;

            if (light instanceof M3D.AmbientLight) {
                r += color.r * intensity;
                g += color.g * intensity;
                b += color.b * intensity;
            }
            else if (light instanceof M3D.DirectionalLight) {

                var uniforms = lightsCache.get( light );

                uniforms.color.copy( light.color ).multiplyScalar( light.intensity );
                uniforms.direction.setFromMatrixPosition( light.matrixWorld );
                uniforms.direction.transformDirection(camera.matrixWorldInverse);
                _lights.directional[ directionalLength ++ ] = uniforms;
            }
            else if (light instanceof M3D.PointLight) {

                var uniforms = lightsCache.get(light);

                // Move the light to camera space
                uniforms.position.setFromMatrixPosition(light.matrixWorld);
                uniforms.position.applyMatrix4(camera.matrixWorldInverse);

                // Apply light intensity to color
                uniforms.color.copy(light.color).multiplyScalar(light.intensity);
                uniforms.distance = light.distance;
                uniforms.decay = ( light.distance === 0 ) ? 0.0 : light.decay;

                _lights.point[pointLength++] = uniforms;
            }
        }

        this._lightsCombined.ambient[0] = r;
        this._lightsCombined.ambient[1] = g;
        this._lightsCombined.ambient[2] = b;

        this._lightsCombined.point.length = pointLength;
    }



    /**
     * SETTERS / GETTERS
     */

    set autoClear (clear) { this._autoClear = clear; }
    get autoClear () { return this._autoClear; }

    /**
     * Sets the url to shader server & directory from which the shaders source is loaded.
     * @param url Full url to the shader server directory
     */
    set setShaderLoaderUrl (url) { this._shaderLoader.setFullUrl(url); }
};