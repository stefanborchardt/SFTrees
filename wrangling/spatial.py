# -*- coding: utf-8 -*-
"""
Created on Sat Mar 19 19:02:15 2016

@author: Stefan
"""

import shapely.geometry as sg
import shapely.ops as so
import shapely.speedups as su
import geojson
import fiona
import rtree
import math
import matplotlib.pyplot as plt
import pandas
import statsmodels.api as sm


def rank():
    su.enable()    
    
    index = rtree.index.Index()
    house_properties = []
    with open("geo_value_clp.json", "r") as house_file:
        houses = geojson.loads(house_file.read())
        for ix, feature in enumerate(houses['features']):
            point = sg.shape(feature['geometry'])
            index.insert(id=ix, 
                         coordinates=(point.bounds))
            props = feature['properties']
            props['geom'] = point
            props['trees'] = 0              
            house_properties.append(props)
            if ix % 10000 == 0:
                print ix
    del houses
            
    with fiona.collection("sfutc_m.shp", "r") as tree_file:  
        tree_polys = [sg.shape(feature['geometry']) for feature in tree_file]
    
    for ix, poly in enumerate(tree_polys):
        if not poly.is_valid:            
            # try to fix invalidities
            poly = poly.buffer(0)
            poly = so.unary_union(poly)
            if not poly.is_valid:
                continue
        # let canopy 'radiate' on surrounding houses
        size_factor = math.sqrt(poly.area) / 3.14         
        #print size_factor
        bpoly = poly.buffer(50 + math.sqrt(size_factor), resolution=8)
        # first get rough estimate of houses
        for hit in index.intersection(bpoly.bounds):
            point = house_properties[hit]['geom']
            # chech more thoroughly
            if bpoly.contains(point):
                house_properties[hit]['trees'] += size_factor 
        if ix % 500 == 0:
                print ix
    del index
    del tree_polys
            
    geo_features = []
    print 'houses to convert: ' + str(len(house_properties))
    for idx, house in enumerate(house_properties):
        if idx % 10000 == 0:
            print idx
        point = house['geom']
        geometry = geojson.Point((point.x, point.y))
        properties = {'addr': house['addr'], 
                      're': house['re'],
                      'rei': house['rei'],
                      'trs': house['trees']}
        gj_house = geojson.Feature(geometry=geometry, properties=properties)
        geo_features.append(gj_house)
    print 'writing geojson'
    gj = geojson.FeatureCollection(geo_features) 
    dump = geojson.dumps(gj)
    with open('geo_value_trees.json', 'w') as f:
        f.write(dump)
    print 'done'
    del gj
    del geo_features
    del dump    
    return
    
    
def plot_save():
    with open('data.json', 'r') as f:
        load = geojson.loads(f.read())
    features = load.features
    data = pandas.DataFrame()
    data['x'] = [x['geometry']['coordinates'][0] for x in features]
    data['y'] = [x['geometry']['coordinates'][1] for x in features]
    data['value'] = [(x['properties']['re']+x['properties']['rei']) for x in features]
    data['trees'] = [math.ceil(math.log1p(x['properties']['trs'])*1.17)+1 for x in features]
    
    data = data[data['value'] < data['value'].quantile(.99)]
    print data.trees.describe()
    print data.value.quantile(.1), data.value.quantile(.9)
    print data.value.describe()
    plt.figure(figsize=(20, 15)) 
    #plt.xlabel('Leafiness Index')
    #plt.ylabel('Real Estate Value')
    
    #plt.scatter(data.x, data.y, c=data.trees, s=4, alpha=0.1)
    #plt.ylim([0, 3000000])
    #plt.boxplot([data[data.trees==x].value for x in range(1, 11)])
    plt.hist(data.trees, bins=10)
    #data.to_csv("data.csv", index=False)
        
    return
    
def regression():
    with open('data.json', 'r') as f:
        load = geojson.loads(f.read())
    features = load.features
    data = pandas.DataFrame()
    data['x'] = [x['geometry']['coordinates'][0] for x in features]
    data['y'] = [x['geometry']['coordinates'][1] for x in features]
    data['value'] = [(x['properties']['re']+x['properties']['rei'])\
                        for x in features]
    data['trees'] = [(x['properties']['trs']) for x in features]
    data['addr'] = [x['properties']['addr'].split(',', 1)[0] for x in features]
    data = data[data['value'] < data['value'].quantile(.99)]   
 
    trees_const = sm.add_constant(data.trees)
    tidx = [math.log1p(x)*1.17 + 1 for x in data.trees]
    data.trees = [int(math.ceil(x)) for x in tidx]
    
    mod = sm.OLS(data.value, trees_const)
    res = mod.fit()
    print res.params
    print res.rsquared
    _, ax = plt.subplots(figsize=(20,15))
    ax.boxplot([data[data.trees==x].value for x in range(1, 11)], 
                showfliers=False)
    data['trees'] = ["{:.4f}".format(x) for x in tidx] 
    print data.trees.describe()           
    data['fitted'] = [int(math.ceil(x)) for x in res.fittedvalues]
    ax.plot(data.trees, res.fittedvalues, 'o')    
    plt.xlabel('Leafiness Index')
    plt.ylabel('Real Estate Value')
    plt.ylim([0, 3000000])   
    
    data.to_csv("datar.csv", index=False, mode='wb', encoding='utf-8')
    
    return
    
if __name__ == "__main__":
    
    #rank()

    
    #plot_save()
    regression()
    


    

