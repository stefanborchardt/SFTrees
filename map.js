"use strict";

var bounds = [-122.5149, 37.7070, -122.359, 37.8120], // WGS84-based left, bottom, right, top
    boundsWidth = bounds[2] - bounds[0],
    boundsHeight = bounds[3] - bounds[1],
    width = window.innerWidth,
    height = window.innerHeight,
    sceneWidth = 2048,
    sceneHeight = sceneWidth / (boundsWidth / boundsHeight);

function transform(value) {
    return Math.pow(value * 0.0005, 0.5);
}

var min = transform(73500),
    mid = transform(425000),
    max = transform(1346000);
var colorScale = d3.scale.linear()
    .domain([transform(20000), min, mid, max, transform(8000000)])
    .range(['#ffffff', '#ffeda0', '#feb24c', '#f03b20', '#000000']);

var renderer = new THREE.WebGLRenderer();
renderer.setSize(width, height);
renderer.sortObjects = false;
renderer.setClearColor(0xcecece);

document.body.appendChild(renderer.domElement);
//document.body.addEventListener('mousemove', onMouseMove, false);

var scene = new THREE.Scene();

var ambLight = new THREE.AmbientLight(0xcccccc);
scene.add(ambLight);

var dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(0, 0, 100).normalize();
scene.add(dirLight);

var camera = new THREE.OrthographicCamera(sceneWidth / -2, sceneWidth / 2, sceneHeight / 2, sceneHeight / -2, -10000, 10000);
camera.position.set(0, -1, 10);
camera.zoom = 6;


//var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();

var controls = new THREE.OrthographicTrackballControls(camera);
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 1.0;
controls.staticMoving = true;


var loader = new THREE.TextureLoader();
loader.crossOrign = '';

loader.load('https://storage.googleapis.com/sftrees3d/sftrees_map.png', function(texture) {
    var planeMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: texture,
        opacity: 0.3
    });
    var planeG = new THREE.PlaneBufferGeometry(sceneWidth, sceneHeight);
    var planeMesh = new THREE.Mesh(planeG, planeMat);
    scene.add(planeMesh);
    render();

});

d3.csv('data.csv').get(function(error, data) {
    if (error) throw error;

    var sceneWAsp = boundsWidth / sceneWidth;
    var sceneHAsp = boundsHeight / sceneHeight;

    var geometry = new THREE.BoxGeometry(1, 1, 1);

    for (var i = 0; i < data.length; i++) {
        var f = data[i];

        var value = transform(f.value),
            sceneX = (f.x - bounds[0]) / sceneWAsp - sceneWidth / 2,
            sceneY = (f.y - bounds[1]) / sceneHAsp - sceneHeight / 2,
            sceneZ = Math.pow(0.67 + f.trees/3, 2);

        var material = new THREE.MeshPhongMaterial({
            color: colorScale(value)
        });
        
        var mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = sceneX;
        mesh.position.y = sceneY;
        mesh.position.z = sceneZ / 2;
        mesh.scale.z = sceneZ;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();

        scene.add(mesh)

    }


});



function render() {
    controls.update();
    requestAnimationFrame(render);
    renderer.render(scene, camera);
}



function onMouseMove(event) {
    mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
    //raycaster.setFromCamera(mouse, camera);

    // See if the ray from the camera into the world hits one of our meshes
    /*
    var intersects = raycaster.intersectObjects(scene.children);

    if (intersects.length > 0) {
        var obj = intersects[0].object;


        console.log(obj.userData)
    }
    */
}
