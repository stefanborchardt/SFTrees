"use strict";

var contentDiv = d3.select("#cont");
var domContDiv = document.getElementById("cont");

var width = domContDiv.clientWidth,
    height = domContDiv.clientHeight;

/*======================== build 3D scene ====================================*/

var bounds = [-122.5149, 37.7070, -122.359, 37.8120], // EPSG:4326 left, bottom, right, top
    boundsWidth = bounds[2] - bounds[0],
    boundsHeight = bounds[3] - bounds[1],
    sceneWidth = 2048,
    sceneHeight = sceneWidth / (boundsWidth / boundsHeight);

var planeMesh;
var baseUrl = "https://storage.googleapis.com/sftrees3d/";
//var baseUrl = "";
var loader = new THREE.TextureLoader();
    loader.crossOrigin = "";
    loader.load(baseUrl + "sftrees_map.png", function(texture) {
        var planeMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            map: texture,
            opacity: 0.3
        });
        var planeG = new THREE.PlaneBufferGeometry(sceneWidth, sceneHeight);
        planeMesh = new THREE.Mesh(planeG, planeMat);
        
    });

function transform(value) {
    return Math.pow(value / 425000.0, 0.5);
}

// polylinear scale white - yellow - orange - red - black
var colorScale = d3.scale.linear()
    .domain([transform(20000), transform(73500), transform(425000), transform(1346000), transform(8000000)])
    .range(['#ffffff', '#ffeda0', '#feb24c', '#f03b20', '#000000']);


var scene, octree;

var ambLight = new THREE.AmbientLight(0xcccccc);
// white light from above to highlight tops of bars
var dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(0, 0, 100).normalize();

function emptyScene() {
    scene = new THREE.Scene();
    scene.add(ambLight);
    scene.add(dirLight);
    octree = new THREE.Octree({overlapPct: 0.2});
}

function makeBars(data, percent) {

    emptyScene();

    var sceneWAsp = boundsWidth / sceneWidth;
    var sceneHAsp = boundsHeight / sceneHeight;

    var geometry = new THREE.BoxGeometry(1, 1, 1);

    var moneyFormat = d3.format(",");

    data.forEach(function(f) {
        if (Math.floor(Math.random() * 100) > percent) {
            // only use <percent>%
            return;
        }
        var value = transform(f.value),
            sceneX = (f.x - bounds[0]) / sceneWAsp - sceneWidth / 2,
            sceneY = (f.y - bounds[1]) / sceneHAsp - sceneHeight / 2,
            // to differiante better visually, transform to (1..4)^2
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
        mesh.userData = {a:f.addr, v: moneyFormat(f.value), t: Math.ceil(f.trees)};

        // only put relevant values into index, sphere around box
        var octrObj = {x: sceneX, y: sceneY, z: sceneZ/2, radius: sceneZ/2+1, id: mesh.id};
        octree.add(octrObj);

        scene.add(mesh)

    });
}

var camera = new THREE.OrthographicCamera(sceneWidth / -2, sceneWidth / 2, sceneHeight / 2, sceneHeight / -2, -5000, 5000);
camera.position.set(0, -5, 10);
camera.zoom = 3;

var controls = new THREE.OrthographicTrackballControls(camera);
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 1.0;
controls.staticMoving = true;

var renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(width, height);
renderer.sortObjects = false;
renderer.setClearColor(0xcecece);

var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var selectedMesh = null;
var white = new THREE.Color("#ffffff");
var black = new THREE.Color("#000000");

function onMouseMove(event) {
    mouse.x = (event.offsetX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -(event.offsetY / renderer.domElement.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // find candidates 
    var octreeResults = octree.search(raycaster.ray.origin, raycaster.ray.far, true, raycaster.ray.direction);

    var hits = [];
    // lookup meshes in scene
    octreeResults.forEach( function(element, index) {
        hits.push(scene.getObjectById(element.object.id));
    });
    // find the mesh(es) pointed at
    var intersections = raycaster.intersectObjects(hits);
    console.log(hits.length);
    var intsLen = intersections.length;
    if (intsLen > 0) {
        var idx = 0;
        if (intsLen > 1) {
            // different addresses geocoded at one location
            idx = Math.floor(Math.random() * intsLen);
        } 
        // manage glow of selected box
        if (selectedMesh != null) {
            selectedMesh.material.emissive = black;
        } 
        var mesh = intersections[idx].object;
        selectedMesh = mesh;
        selectedMesh.material.emissive = white;
        // display details
        var userData = selectedMesh.userData;
        contentDiv.select("#details")
            .text("")
            .append("div")
            .attr("class", "detail")
            .text(userData.a)
            .append("div")
            .attr("class", "detail")
            .text("Value: $ " + userData.v)
            .append("div")
            .attr("class", "detail")
            .text("Leafiness Index: " + userData.t);

    }

}

var aniFrameId = null;

function animate() {
    controls.update();
    aniFrameId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
    octree.update();
}

function render() {
    
    scene.add(planeMesh);

    domContDiv.appendChild(renderer.domElement);
    domContDiv.addEventListener('mousemove', onMouseMove, false);
    
    animate();

    // display infoboxes
    contentDiv.selectAll("#details")
        .data([""])
        .enter()
        .append("div")
        .attr("id", "details")
        .text("Rotate and Zoom, Pan with right mouse button. Hover for details.")

    var randDiv = contentDiv.selectAll("#random")
        .data([""])
        .enter()
        .append("div")
        .attr("id", "random")
        .text("Choose another random subset: ")

    randDiv.append("a")
        .attr("href", "")
        .attr("class", "randlink")
        .attr("onclick", "toRender(10);return false;")
        .text("10%");
    randDiv.append("a")
        .attr("href", "")
        .attr("class", "randlink")
        .attr("onclick", "toRender(20);return false;")
        .text("20%");
    randDiv.append("a")
        .attr("href", "")
        .attr("class", "randlink")
        .attr("onclick", "toRender(30);return false;")
        .text("30%");
    randDiv.append("a")
        .attr("href", "")
        .attr("class", "randlink")
        .attr("onclick", "toRender(50);return false;")
        .text("50%");
    randDiv.append("a")
        .attr("href", "")
        .attr("class", "randlink")
        .attr("onclick", "toRender(100);return false;")
        .text("100% (slow)");

}

/*======================== prepare box plot ====================================*/

function iqr(k) {
// returns function to determine the index of array elements 
// that are at q1 - k*IQR and q3 + k*IQR, 
// with IQR being 3rd quantile minus 1st quantile
// typical value for k is 1.5
    return function(d, i) {
        var q1 = d.quartiles[0],
            q3 = d.quartiles[2],
            iqr = (q3 - q1) * k,
            i = -1,
            j = d.length;
        while (d[++i] < q1 - iqr);
        while (d[--j] > q3 + iqr);
        return [i, j];
    };
}

var margin = {top: 40, left: 70};

var chartWidth = width - 2*margin.left;
var boxWidth = chartWidth / 10;
var boxHeight = (height - 2*margin.top);
//var valueDomain = [20027, 7869264];
var valueDomain = [0, 3000000];

var chart = d3.box()
    .whiskers(iqr(1.5))
    .width(boxWidth / 2)
    .height(boxHeight)
    .domain(valueDomain);

// for numbers under box plots
var xOrdScale = d3.scale.ordinal()     
    .domain(d3.range(1, 11))
    .range(d3.range(0.75*boxWidth, 10.75*boxWidth, boxWidth));    
var xAxis = d3.svg.axis()
    .scale(xOrdScale)
    .orient("bottom")
    .tickSize(0, 0);
// regression fitted values
var xLinScale = d3.scale.linear()     
    .domain([1.0, 10.0])
    .range([0.75*boxWidth, 9.75*boxWidth]); 

var yScale = d3.scale.linear()
    .domain(valueDomain)
    .range([boxHeight, 0]);
var yAxis = d3.svg.axis()
    .scale(yScale)
    .orient("left");

function preparePlot(data) {
    var plotData = [];
    var regData = [];
    data.forEach(function(f) {
        var value = f.value;
        var trees = Math.ceil(f.trees);
        if (!plotData[trees]) {
            plotData[trees] = [value];
        } else {
            plotData[trees].push(value);
        }
        if (Math.floor(Math.random() * 10) == 0) {
            // only use 10% of points for regression line
            regData.push({tcont: f.trees, fitted: f.fitted});
        }
    });
    return [plotData, regData];
}


function showPlot(plotData, regData) {
    var svg = contentDiv.append("svg")
        .attr("width", width)
        .attr("height", height);
    // two groups on top of each other: g-boxplots r-regression values    
    var g = svg.append("g")
        .attr("id", "box-container")
        .attr("transform", "translate(" + margin.left + ", " + margin.top + ")");
    var r = svg.append("g")
        .attr("id", "regr-container")
        .attr("transform", "translate(" + margin.left + ", " + margin.top + ")");
    // boxplots
    g.selectAll(".box")
        .data(plotData)
        .enter()
        .append("g")
        .attr("class", "box")  
        .attr("width", boxWidth)
        .attr("height", boxHeight)
        .attr("transform", function(d, i) { 
            if (!d) return "scale(0)";
            return "translate(" +  (i-0.5) * boxWidth  + ", 0)"; 
        })
        .call(chart);
    // regression fitted values    
     r.selectAll(".dot")
        .data(regData)
        .enter()
        .append("circle")
        .attr("class", "dot")  
        .attr("r", 4)
        .attr("cx", function(d) { return xLinScale(d.tcont); })
        .attr("cy", function(d) { return yScale(d.fitted); });
    // y axis
    svg.append("g")
        .attr("class", "y axis")
        .attr("transform", "translate(" + margin.left + ", " + margin.top + ")")
        .call(yAxis)
        .append("text") // and text1
        .attr("transform", "rotate(-90)")
        .attr("x", -50)
        .attr("y", 10)
        .attr("dy", ".71em")
        .style("text-anchor", "end")
        .style("font-size", "16px") 
        .text("Real Estate Value");        
    // x axis  
    svg.append("g")
        .attr("class", "x axis")
        .attr("transform", "translate(" + margin.left + ", " + (boxHeight + margin.top) + ")")
        .call(xAxis)
        .append("text")             // text label for the x axis
        .attr("x", (width / 2) - margin.left)
        .attr("y",  22)
        .attr("dy", ".71em")
        .style("text-anchor", "middle")
        .style("font-size", "16px") 
        .text("Leafiness Index"); 
}


/*======================== progress bar ====================================*/

var progress = 0,
    formatPercent = d3.format(".0%");

var arc = d3.svg.arc()
    .startAngle(0)
    .innerRadius(180)
    .outerRadius(240);

var svg = contentDiv.append("svg")
    .attr("width", width)
    .attr("height", height)
    .append("g")
    .attr("transform", "translate(" + width / 2 + "," + height / 2 + ")");

var meter = svg.append("g")
    .attr("class", "progress-meter");
meter.append("path")
    .attr("class", "background")
    .attr("d", arc.endAngle(2 * Math.PI));
var foreground = meter
    .append("path")
    .attr("class", "foreground");
var text = meter
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", ".35em");

/*======================== preloading, display ====================================*/

function resetDivs() {
    var divs = document.getElementsByClassName("swap")
    for (var i = 0; i < divs.length; i++) {
        divs[i].style.display = "none";
    }
    if (aniFrameId != null) {
        cancelAnimationFrame(aniFrameId);
        aniFrameId = null;
    }
    var kids = domContDiv.childNodes;
    for (var i = 0; i < kids.length; i++) {
        domContDiv.removeChild(kids[i]);
    }
}

function toIntro() {
    resetDivs();
    var next = document.getElementById("nxtlnk");
    next.setAttribute("onclick", "toPlot();return false;");
    var div = document.getElementById("intro")
    div.style.display = "block";
}

function toDesign() {
    resetDivs();
    var div = document.getElementById("design")
    div.style.display = "block";
}

function toLicenses() {
    resetDivs();
    var div = document.getElementById("licenses")
    div.style.display = "block";
}

function toFeedback() {
    resetDivs();
    var div = document.getElementById("feedback")
    div.style.display = "block";
}

var plotData;
var regData; 

function toPlot() {
    resetDivs();
    var next = document.getElementById("nxtlnk");
    next.setAttribute("onclick", "toRender(20);return false;");

    showPlot(plotData, regData);
}

var data;
var firstRun = true;

function toRender(percent) {
    resetDivs();
    var next = document.getElementById("nxtlnk");

    next.style.display = "none";

    if (firstRun) {
        firstRun = false;
    } else {
        makeBars(data, percent);
    }
    render();
}


d3.csv(baseUrl + "datar.csv")
    .on("progress", function() {
        var ip = d3.interpolate(progress, d3.event.loaded / d3.event.total);
        d3.transition().tween("progress", function() {
            return function(t) {
                progress = ip(t);
                foreground.attr("d", arc.endAngle(2 * Math.PI * progress));
                text.text(formatPercent(progress));
            };
        });
    })
    .get(function(error, loaded) {
        
        /*========= MAIN =============*/

        data = loaded;

        makeBars(data, 20);

        var ppData = preparePlot(data);
        plotData = ppData[0];
        regData = ppData[1];

        meter.transition().attr("transform", "scale(0)");
        d3.select("svg").transition().remove();

        toIntro();
        
    });


