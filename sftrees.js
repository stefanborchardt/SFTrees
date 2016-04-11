"use strict";

// the div intended for content, as DOM and D3 
var contentDiv = d3.select("#cont");
var domContDiv = document.getElementById("cont");

var width = domContDiv.clientWidth,
    height = domContDiv.clientHeight;

/*======================== build 3D scene ====================================*/
// spatial coordinates EPSG:4326 left, bottom, right, top
var bounds = [-122.5149, 37.7070, -122.359, 37.8120], 
    boundsWidth = bounds[2] - bounds[0],
    boundsHeight = bounds[3] - bounds[1];
// the internal resolution of the 3D scene
var sceneWidth = 2048,
    sceneHeight = sceneWidth / (boundsWidth / boundsHeight);

var baseUrl = "https://storage.googleapis.com/sftrees3d/";
//var baseUrl = "";

var textureMesh;
var plotData;
var regrData; 
var data;

var loader = new THREE.TextureLoader();
    loader.crossOrigin = "";
    loader.load(baseUrl + "sftrees_map.png", function(texture) {
        var planeMat = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide
        });
        var planeG = new THREE.PlaneBufferGeometry(sceneWidth, sceneHeight);
        textureMesh = new THREE.Mesh(planeG, planeMat);
        // after texture has loaded, load the csv - otherwise timing issues 
        d3.csv(baseUrl + "datar.csv")
            .on("progress", function() {
                // display progress indicator, see close to bottom of file
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
                // prepare 3D map
                makeBars(data, 20);
                // prepare boxplot
                var ppData = preparePlot(data);
                plotData = ppData[0];
                regrData = ppData[1];
                // remove progress circle
                meter.transition().attr("transform", "scale(0)");

                // show the intro screen
                d3.select("svg").transition().remove().each("end", toIntro);

                
            });

    });

function transformValue(value) {
    // transforms the real estate value by dividing through the median and taking sqrt
    return Math.pow(value / 425000.0, 0.5);
}

function transformTrees(trees) {
    // transforms the leafiness index to differantiate better visually, transform to (1..4)^2
    // the index has been calculated from the raw value by logarithm
    return Math.pow(0.67 + trees/3.0, 2)
}

// polylinear scale white - yellow - orange - red - black
var colorDomainCols = ['#ffffff', '#ffeda0', '#feb24c', '#f03b20', '#000000'];
var colorScale = d3.scale.linear()
    .domain([transformValue(20000), transformValue(73500), transformValue(425000), transformValue(1346000), transformValue(8000000)])
    .range(colorDomainCols);


var scene, octree;

var ambLight = new THREE.AmbientLight(0xcccccc);
// white light from above to highlight tops of bars
var dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(0, 0, 100).normalize();

function emptyScene() {
    // sets up or clears the scene
    scene = new THREE.Scene();
    scene.add(ambLight);
    scene.add(dirLight);
    octree = new THREE.Octree({overlapPct: 0.2});
}

function makeBars(data, percent) {
    // puts all bars (boxes/ columns) on the map and in the search index
    // using geometry instancing and buffer geometry for speed

    emptyScene();

    var sceneWAsp = boundsWidth / sceneWidth;
    var sceneHAsp = boundsHeight / sceneHeight;

    var geometry = new THREE.BoxGeometry(1, 1, 1);

    // separate thousands
    var moneyFormat = d3.format(",");

    data.forEach(function(f) {
        if (Math.floor(Math.random() * 100) > percent) {
            // only use <percent>%
            return;
        }
        var value = transformValue(f.value),
            sceneX = (f.x - bounds[0]) / sceneWAsp - sceneWidth / 2,
            sceneY = (f.y - bounds[1]) / sceneHAsp - sceneHeight / 2,
            sceneZ = transformTrees(f.trees);

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
        // add data for detail info
        mesh.userData = {a:f.addr, v: moneyFormat(f.value), t: Math.ceil(f.trees)};

        // only put relevant values into index, sphere around box
        var octrObj = {x: sceneX, y: sceneY, z: sceneZ/2, radius: sceneZ/2+1, id: mesh.id};
        octree.add(octrObj);

        scene.add(mesh)

    });
}

// use orthographic view for better comparability
var camera = new THREE.OrthographicCamera(sceneWidth / -2, sceneWidth / 2, sceneHeight / 2, sceneHeight / -2, -5000, 5000);
camera.position.set(0, -5, 10);
camera.zoom = 3;

var controls = new THREE.OrthographicTrackballControls(camera, domContDiv);
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
    // displays detail information

    mouse.x = (event.offsetX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -(event.offsetY / renderer.domElement.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // find candidates 
    var octreeResults = octree.search(raycaster.ray.origin, raycaster.ray.far, true, raycaster.ray.direction);

    var hits = [];
    // lookup meshes for candidates in scene
    octreeResults.forEach( function(element, index) {
        hits.push(scene.getObjectById(element.object.id));
    });
    // find the mesh(es) pointed at
    var intersections = raycaster.intersectObjects(hits);
    var intsLen = intersections.length;
    if (intsLen > 0) {
        var idx = 0;
        if (intsLen > 1) {
            // different addresses geocoded at one location, flicker
            idx = Math.floor(Math.random() * intsLen);
        } 
        // manage 'glow' of selected box
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

// to be able to cancel the animation 
var aniFrameId = null;

function animate() {
    // runs the 3D map
    controls.update();
    aniFrameId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
    octree.update();
}

function render() {
    // puts all the parts of the 3D map together and displays it
    
    scene.add(textureMesh);

    var canvas = domContDiv.appendChild(renderer.domElement);
    canvas.addEventListener('mousemove', onMouseMove, false);
    
    animate();

    // display infobox for details
    contentDiv
        .append("div")
        .attr("id", "details")
        .attr("class", "infobox")
        .text("Hover for details");

    // the legend...
    var legendSvg = contentDiv
        .append("div")
        .attr("id", "legend")
        .attr("class", "infobox")
        .append("svg")
        .attr("id", "lgnd-svg");
    // ... for color
    var legendCol = legendSvg
        .append("g")
        .attr("id", "lgnd-colors");
    // ... and height
    var legendHeight = legendSvg.append("g")
        .attr("id", "lgnd-heights");

    legendCol.selectAll("rect")
        .data(colorDomainCols)
        .enter()
        .append("rect")
        .attr("width", 32)
        .attr("height", 10)
        .attr("y", 0)
        .attr("fill", function(d) {return d;})
        .attr("x", function(d, i) {return i*32;});
     // ... still drawing the legend...   
    legendCol.selectAll("text")
        .data(["20K", "73K", "425K", "1.4M", " 8M"])
        .enter()
        .append("text")
        .attr("y", 20)
        .attr("x", function(d, i) {return i*32 + 6;})
        .text(function(d, i) {return d;});
    // differences in height look smaller in the legend, maybe because the 3D boxes are slimmer?    
    legendHeight.selectAll("rect")
        .data([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        .enter()
        .append("rect")
        .attr("width", 8)
        .attr("y",  function(d) {return 68 - transformTrees(d)*3;})
        .attr("height", function(d) {return transformTrees(d)*3;})
        .attr("x", function(d, i) {return i*16 + 8;});
    // last part of legend
    legendHeight.selectAll("text")
        .data([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        .enter()
        .append("text")
        .attr("y", 78)
        .attr("x", function(d, i) {return i*16 + 7;})
        .text(function(d, i) {return d;});

    // box for switching data amount
    var randDiv = contentDiv
        .append("div")
        .attr("id", "random")
        .attr("class", "infobox")
        .text("Rotate and Zoom, Pan with right mouse button. Or choose another random subset: ")
    // the various links for random subsets, TODO: change to data/enter   
    randDiv.append("a")
        .attr("href", "")
        .attr("class", "randlink")
        .attr("onclick", "toRender(10);return false;")
        .text("(fast)\u00A010%");
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
        .text("100%\u00A0(slow)");

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

// called in showplot() - this type of plot draws on box without axes, labels, and fliers
var chart = d3.box()
    .whiskers(iqr(1.5))
    .width(boxWidth / 2)
    .height(boxHeight)
    .domain(valueDomain);

// for leafiness index/ numbers under box plots
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
// real estate values
var yScale = d3.scale.linear()
    .domain(valueDomain)
    .range([boxHeight, 0]);
var yAxis = d3.svg.axis()
    .scale(yScale)
    .orient("left");

function preparePlot(data) {
    // returns two arrays from random 10% of data:
    // plotData contains the real estate values for each leafiness index
    // regrData contains the fitted real estate value for the raw leafiness on a continuous scale
    var plotData = [];
    var regrData = [];
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
            regrData.push({tcont: f.trees, fitted: f.fitted});
        }
    });
    return [plotData, regrData];
}


function showPlot(plotData, regrData) {
    // draws and shows the box plot with overlay of fitted values
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
    // 10 boxplots, one for each leafiness index
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
        .data(regrData)
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
        .append("text") 
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
        .append("text")             
        .attr("x", (width / 2) - margin.left)
        .attr("y",  22)
        .attr("dy", ".71em")
        .style("text-anchor", "middle")
        .style("font-size", "16px") 
        .text("Leafiness Index"); 
    // explanation
    var txt = svg.append("text")
        .attr("class", "box-explain")
        .attr("x", 150)
        .attr("y", 60)
    var texts = [
        "You can see two things here. If you calculate how (on average)",
        "house prices change with the raw leafiness you get the green line.",
        "It's more dense where more values are. Secondly, the boxes allow you",
        "to see how property values are distributed within each group of leafiness.",
        "The box marks the medium 50%, the line in it is the median. Values ",
        "outside a range of 75% (the handles) have been omitted for clarity."]
    txt.selectAll("tspan")
        .data(texts)
        .enter()
        .append("tspan")
        .attr("x", 150)
        .attr("dy", 16)
        .text(function(d) {return d;});

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

/*======================== static content, navigation ====================================*/

function resetDivsGetNext() {
    // sets all static content to display:none, stops 3D animation, 
    // sets next button to start page, empties content div,
    // and returns the next button to alternate its behavior
    var divs = document.getElementsByClassName("swap")
    for (var i = 0; i < divs.length; i++) {
        divs[i].style.display = "none";
    }
    if (aniFrameId != null) {
        cancelAnimationFrame(aniFrameId);
        aniFrameId = null;
    }
    var kids = domContDiv.children;
    for (var i = kids.length-1; i >= 0; i--) {
        domContDiv.removeChild(kids[i]);
    }
    var next = document.getElementById("nxtlnk");
    next.style.display = "block";
    next.setAttribute("onclick", "toIntro();return false;");
    return next;
}

function toIntro() {
    resetDivsGetNext().setAttribute("onclick", "toPlot();return false;");
    var div = document.getElementById("intro")
    div.style.display = "block";
}

function toDesign() {
    resetDivsGetNext();
    var div = document.getElementById("design")
    div.style.display = "block";
    // lazy load images
    d3.select("#design")
        .selectAll("img")
        .each(function(d, i){
            var urls = [
                "sketches/1_sftrees.png",
                "sketches/3_tree_canopy.png",
                "sketches/4_tree_canopy_simplified_vec.png",
                "sketches/5_combined_topojson.png",
                "sketches/7_iteration1.png",
                "sketches/2_property_values_inprogress.png",
                "sketches/8_re_value.png",
                "sketches/9_canopy_before.png",
                "sketches/10_canopy_simplified.png",
                "sketches/11_tree_density.png",
                "sketches/12_regression.png"];
            this.setAttribute("src", baseUrl + urls[i]);
        });
}

function toLicenses() {
    resetDivsGetNext();
    var div = document.getElementById("licenses")
    div.style.display = "block";
}

function toFeedback() {
    resetDivsGetNext();
    var div = document.getElementById("feedback")
    div.style.display = "block";
}

function toPlot() {
    resetDivsGetNext().setAttribute("onclick", "toRender(20);return false;");
    
    showPlot(plotData, regrData);
}

var firstRun = true;

function toRender(percent) {
    resetDivsGetNext().setAttribute("onclick", "toOutro();return false;");
    // on first run use prepared scene with 20% data
    if (firstRun) {
        firstRun = false;
    } else {
        makeBars(data, percent);
    }
    render();
}

function toOutro() {
    resetDivsGetNext().style.display = "none";
    var div = document.getElementById("outro")
    div.style.display = "block";
}




