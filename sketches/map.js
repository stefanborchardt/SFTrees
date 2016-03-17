var bounds = [253700, 6637800, 273800, 6663700], // UTM 33N left, bottom, right, top
    boundsWidth = bounds[2] - bounds[0],
    boundsHeight = bounds[3] - bounds[1],
    cellSize = 100,
    xCells = boundsWidth / cellSize,
    yCells = boundsHeight / cellSize,
    sceneWidth = 100,
    sceneHeight = 100 * (boundsHeight / boundsWidth),
    boxSize = sceneWidth / xCells,
    valueFactor = 0.02,
    width = window.innerWidth,
    height = window.innerHeight;

var colorScale = d3.scale.linear()
    .domain([0, 100, 617])
    .range(['#fec576', '#f99d1c', '#E31A1C']);


var scene = new THREE.Scene();

var camera = new THREE.PerspectiveCamera(20, width / height, 0.1, 1000);
camera.position.set(0, -200, 120);

var controls = new THREE.TrackballControls(camera);
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();

var renderer = new THREE.WebGLRenderer();
renderer.setSize(width, height);
document.body.appendChild(renderer.domElement);
document.body.addEventListener('mousemove', onMouseMove, false);

var ambLight = new THREE.AmbientLight(0x777777);
scene.add(ambLight);

var dirLight = new THREE.DirectionalLight(0xcccccc, 1);
dirLight.position.set(-70, -50, 80);
scene.add(dirLight);

var csv = d3.dsv(' ', 'text/plain');

csv('data/Oslo_bef_100m_2015.csv').get(function(error, data) { // ru250m_2015.csv

    var geometry = new THREE.BoxBufferGeometry(boxSize, boxSize, 1);

    for (var i = 0; i < data.length; i++) {

        var id = data[i].rute_100m,
            utmX = parseInt(id.substring(0, 7)) - 2000000 + cellSize, // First seven digits minus false easting
            utmY = parseInt(id.substring(7, 14)) + cellSize, // Last seven digits
            sceneX = (utmX - bounds[0]) / (boundsWidth / sceneWidth) - sceneWidth / 2,
            sceneY = (utmY - bounds[1]) / (boundsHeight / sceneHeight) - sceneHeight / 2,
            value = parseInt(data[i].sum);

        var material = new THREE.MeshPhongMaterial({
            color: colorScale(value)
        });

        var mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = sceneX;
        mesh.position.y = sceneY;
        mesh.position.z = value * valueFactor / 2;
        mesh.scale.z = value * valueFactor;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData = "id_" + id;

        scene.add(mesh);
    }

});

render();

function render() {
    controls.update();
    requestAnimationFrame(render);
    renderer.render(scene, camera);
}

function onMouseMove(event) {
    mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // See if the ray from the camera into the world hits one of our meshes

    var intersects = raycaster.intersectObjects(scene.children);

    if (intersects.length > 0) {

        console.log(intersects[0].object.userData)
    }
}