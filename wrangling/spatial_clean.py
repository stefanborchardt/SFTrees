# -*- coding: utf-8 -*-
"""
Created on Tue Mar 22 20:35:57 2016

@author: Stefan
"""

import shapely.geometry as sg
import shapely.ops as so
import fiona
import pandas
import matplotlib.pyplot as plt
import math

def stats(df):
    print df.describe()
    total_area = sum(df[0])
    print "sum of all areas: ", total_area, " - ",\
        total_area/180691558.0*100, "%" 
    areas = [math.log(x) for x in df[0]]
    plt.hist(areas, bins=30)
    plt.show
    print pandas.DataFrame(areas).describe()
    return
    

    
if __name__ == "__main__":
  
    with fiona.collection("sfutc_merged.json", "r") as in_file:
        areas = []
        for item in in_file:
            pass
            poly = sg.shape(item['geometry'])
            areas.append(poly.area)
    pa = pandas.DataFrame(areas)
    plt.figure(figsize=(8, 8))
    stats(pa)




    
    
    