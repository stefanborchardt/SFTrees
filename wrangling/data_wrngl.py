# -*- coding: utf-8 -*-
"""
Created on Sat Feb 13 10:54:21 2016

@author: Stefan
"""

import pandas
import googlemaps
import re
import csv
import numpy
import json
import apiclient.discovery
import pprint
import difflib
import itertools
import geojson


FILE_PROPERTY = 'property.json'
FILE_ADDRESSES = 'addresses.json'
FILE_ADDRESSES_GEO = 'addresses_geo.json'
FILE_PROPERTY_SUMMED = 'property_summed.json'
FILE_COMBINED = 'combined.json'
FILE_GEOJSON = 'geo_re_value.json'
FILE_TREES = 'sftrees.json'
FILE_SPECIES = 'treespecies.json'
FILE_DB_SPECIES = 'dbspecies.json'


def convertExcel():
    """ Reads property assessment excel, remove records with unclear address,
    write to json file.
    """
    
    p13 = pandas.read_excel('SanFranciscoPropertyAssessmentRoll2013.xlsx', 
                            sheetname='2013Secured')
    p13 = p13[['Situs', 'Zip', 'RE', 'RE_Improvements','Taxable Value']]
    print 'All records ' + str(len(p13))
    p13 = p13[(p13['Taxable Value'] > 0 ) & (p13['RE'] > 0)]
    print 'After removing 0 values ' + str(len(p13))
    minlen = p13['Situs'].map(lambda x: len(str(x)) > 3)
    p13 = p13[minlen]
    print 'After removing situs length < 4 ' + str(len(p13))
    # regex for 2x2 letters, like '6TH ST'
    re_min4ltrs = re.compile('[A-Z]{2,}.*[A-Z]{2,}')
    testltrs  = p13['Situs'].map(lambda x: re_min4ltrs.search(x) != None)
    p13 = p13[testltrs]
    p13 = p13[minlen]
    print 'After removing situs less than 2 times 2 letters ' + str(len(p13))
    p13.to_json(FILE_PROPERTY, orient='records')
    return

# regex for removal of unit number
re_apnum = re.compile('[0-9\\-]+[A-Z]?$')
re_pine_st = re.compile('1000 PINE [0-9A-Z]+ ST')

def removeApartment(a):
    """ Removes unit number. """
    a = a.strip()
    if a.find('UNIT') > -1:
        a = a[:a.find('UNIT')]
    if a.find('#') > -1:
        a = a[:a.find('#')]
    match = re_apnum.search(a)
    if match:
        a = a[:match.start()]
        a = a.strip()
        # apply again for the hard cases of unit numbers     
        match = re_apnum.search(a)
        if match:
            a = a[:match.start()]
    # and a very special case
    match = re_pine_st.search(a)    
    if match:
        a = "1000 PINE ST"        
    a = a.strip()
    return a
    
def cleanAddresses():
    """ Cleanes Situs field and writes unique addresses as json """
    p13 = pandas.read_json(FILE_PROPERTY, orient='records')
    print 'Initial # of unique sitii ' + str(len(pandas.unique(p13['Situs'])))
    p13['cleaned'] = p13.apply(lambda row: removeApartment(row['Situs']), 
                               axis=1)
    p13['Zip'] = p13['Zip'].apply(lambda x: str(x)[:5] if x > 0 else '')                           
    p13.to_json(FILE_PROPERTY, orient='records')
    print '# of unique sitii after cleaning ' + \
        str(len(pandas.unique(p13['cleaned'])))
    # only unique addresses
    uq_addresses = p13.drop_duplicates('cleaned')
    uq_addresses = uq_addresses[['cleaned', 'Zip']] 
    uq_addresses.columns = ['addr', 'zip']                    
    print 'Unique addresses ' + str(len(uq_addresses))
    uq_addresses.to_json(FILE_ADDRESSES, orient='records')                          
    return

def sumValues():
    """ Groups by cleaned address and sums property values. """
    p13 = pandas.read_json(FILE_PROPERTY, orient='records')
    values = p13[['cleaned', 'RE', 'RE_Improvements','Taxable Value' ]]
    summed = values.groupby('cleaned', as_index=False).aggregate(numpy.sum)
    summed.to_json(FILE_PROPERTY_SUMMED, orient='records')
    print 'Summed records ' + str(len(summed))
    return
    
def geocode():
    """ Geocodes cleaned addresses (that have not been coded before and ADDS 
    them to json file. 
    """
    uq_addresses = pandas.read_json(FILE_ADDRESSES, orient='records')
    print 'Unique addresses ' + str(len(uq_addresses))
    geo_addresses = pandas.read_json(FILE_ADDRESSES_GEO, orient='records')
    gmaps = googlemaps.Client(key=keys['gmapskey'][0])
    max_requests = 2000
    skip_first = 0
    for ix, addr in uq_addresses.iterrows(): 
        if skip_first > 0:
            # don't check the first rows if they are already geocoded
            skip_first -= 1
            if skip_first % 10000 == 0:
                print 'still skipping'
            continue
        if len(geo_addresses[geo_addresses['addr'] == addr['addr']]) > 0:
            # don't do already geocoded again 
            continue
        if max_requests == 0:
            # only max number of requests
            break
        max_requests -= 1
        if max_requests % 60 == 0:
            # print progress
            print max_requests
        if max_requests % 300 == 0:
            # save from time to time
            geo_addresses.to_json(FILE_ADDRESSES_GEO, orient='records')   
        geocode_result = gmaps.geocode(addr['addr'] + ', San Francisco, CA ' +\
                                       str(addr['zip']))
        if len(geocode_result) >= 1:        
            result = geocode_result[0]
            ua_geo = addr
            ua_geo['lat'] = str(result['geometry']['location']['lat'])
            ua_geo['lng'] = str(result['geometry']['location']['lng'])
            ua_geo['loc_type'] = result['geometry']['location_type']
            ua_geo['formatted'] = result['formatted_address']
            ua_geo['partial'] = result.get('partial_match', False)
            ua_geo['type'] = next(iter(result['types']), '')
            geo_addresses = geo_addresses.append(ua_geo)
        else:
            print '\nno result'
            print addr['addr'] + ', San Francisco, CA ' + str(addr['zip'])

    print 'Total geocoded addresses ' + str(len(geo_addresses))
    geo_addresses.to_json(FILE_ADDRESSES_GEO, orient='records') 
    return
    
def combineRESumGeo():
    geo_addresses = pandas.read_json(FILE_ADDRESSES_GEO, orient='records')
    geo_addresses = geo_addresses[geo_addresses['loc_type'] != 'APPROXIMATE']
    summed = pandas.read_json(FILE_PROPERTY_SUMMED, orient='records')

    combined = summed.merge(geo_addresses, left_on='cleaned', right_on='addr', 
                         how='inner')
              
    combined.to_json(FILE_COMBINED, orient='records') 
    combined.to_csv('combined.csv', quoting=csv.QUOTE_NONNUMERIC, 
                    encoding='UTF-8')
    return
    
def toGeoJson():
    re_addr = pandas.read_json(FILE_COMBINED, orient='records')
    geo_features = []
    print 'addresses to convert: ' + str(len(re_addr))
    for idx, addr in re_addr.iterrows():
        if idx % 10000 == 0:
            print idx
        geometry = geojson.Point((addr.lat, addr.lng))
        properties = {'addr': addr.formatted, 
                      'val': addr.RE + addr.RE_Improvements}
        gj_addr = geojson.Feature(geometry=geometry, properties=properties)
        geo_features.append(gj_addr)
    print 'writing geojson'
    gj = geojson.FeatureCollection(geo_features) 
    dump = geojson.dumps(gj)
    with open(FILE_GEOJSON, 'w') as f:
        f.write(dump)
    print 'done'
    return
    
    
###################################    
    
def cleanTrees():
    """ OVERWRITES tree json file after removing metadata and unnecessary 
    columns.
    """
    with open(FILE_TREES, 'r') as f:
        trees_json = json.loads(f.read())
    colnames = []
    for col in trees_json['meta']['view']['columns']:
        colnames.append(col['fieldName'])   
    trees = pandas.DataFrame(trees_json['data'])
    trees.columns = colnames
    trees = trees[['qspecies', 'qaddress', 'siteorder', 'plantdate', 'dbh', 
                   'latitude', 'longitude']]
    trees.to_json(FILE_TREES, orient='records')
    return
    
def removeXSpecies(s):
    match = re.search('\\sx\\s|\\s\\xd7\\s', s)
    if match: 
        return s[:match.start()] + s[match.start()+2:]
    if s == 'Tree(s)' or s == 'Tree' or s == 'Asphalt patch' or s == 'Shrub':
        return None
    return s    
    
def cleanSpeciesNames(df, column_name):
    species = df[column_name]
    # remove common name
    species = species.apply(lambda x: x.split('::')[0].strip())
    # remove variety name
    species = species.apply(lambda x: x.split('\'')[0].strip())
    # remove unhelpful additions
    species = species.apply(lambda x: re.sub('spp|Spp\\.?|subsp\\.?', '', x).strip())
    # remove additional comments
    species = species.apply(lambda x: x.split('(')[0].strip())
    # remove x at beginning and end
    species = species.apply(lambda x: re.sub('\\sx$|^x\\s+', '', x).strip())
    # remove x in middle and some nonsense names
    species = species.apply(lambda x: removeXSpecies(x))
    return species

    
def updateSpeciesDB():
    db = pandas.read_json(FILE_DB_SPECIES, orient='records') 
    service = apiclient.discovery.build('customsearch', 'v1',
            developerKey=keys['searchkey'][0])
    species_infos = []
    counter = 0
    for s in db:
        res = service.cse().list(
            q=s, cx=keys['eolsearch'][0],
            fields='spelling/correctedQuery,items(title,link)').execute()
        counter += 1
        if counter % 20 == 0:
            # show progress
            print counter
        spec_inf = {}
        spec_inf['name'] = s
        if res.get('spelling'):
            spec_inf['corrected'] = res['spelling']['correctedQuery']
        if res.get('items'):
            # take first result
            i0 = res['items'][0]
            spec_inf['link'] = i0['link'] 
            spec_inf['title'] = i0['title']  
        elif res.get('spelling'):
            # no results but spelling correction, try again
            res = service.cse().list(
                q=spec_inf['corrected'], 
                cx=keys['eolsearch'][0],
                fields='spelling/correctedQuery,items(title,link)').execute()
            if res.get('items'):
                i0 = res['items'][0]
                spec_inf['link'] = i0['link'] 
                spec_inf['title'] = i0['title'] 
            else:
                # very uncommon case
                print s
                pprint.pprint(res)
        else:
            print s
            pprint.pprint(res)
        species_infos.append(spec_inf)
    species_infos = pandas.DataFrame(species_infos)
    species_infos.to_json(FILE_SPECIES, orient='records') 
    species_infos.to_csv('species.csv', quoting=csv.QUOTE_NONNUMERIC, 
                    encoding='UTF-8')
    
    return
    

def removeXSpecies2(s):
    match = re.search('\\bx\\w', s)
    if match:
        return s[:match.start()] + s[match.start()+1:]
    return s
    
def mergeSpeciesLists():
    spec_toadd = pandas.read_csv('uf_species.csv')
    spec_before = pandas.read_json(FILE_SPECIES, orient='records')
    
    # remove superfluous columns
    speca = spec_toadd[['id', 'scientific_name',  
    'native_status', 'fall_conspicuous', 
    'flower_conspicuous', 'bloom_period', 'palatable_human', 
     'fruit_period', 'wildlife_value']]    


    speca['correct'] = speca['scientific_name'].apply(lambda x: 
                        removeXSpecies2(x))    

    species = speca.merge(spec_before, on='correct', how='outer')
    dup = species[species.duplicated('correct')][['id', 'scientific_name', 'correct']]
    
    species.to_json('allspecies.json', orient='records')
    dup.to_csv('duplicates.csv')

    return    

def addUTThumbs():
    db = pandas.read_json(FILE_DB_SPECIES, orient='records') 
    service = apiclient.discovery.build('customsearch', 'v1',
            developerKey=keys['searchkey'][0])
    thumbs = []
    counter = 0
    for _, si in db.iterrows(): 
        search = si['sc_name_corr']
        res = service.cse().list(
                q=search + ' tree', 
                cx=keys['urbantree'][0],\
                fields='items(title,link),items/pagemap(cse_image,cse_thumbnail)')\
                .execute()
        counter += 1
        if counter % 20 == 0:
            # show progress
            print counter
        items = res.get('items')
        if not items:
            print 'NO RESULT: ' + search
            pprint.pprint(res)
            continue

        titles = []
        for item in items:
            titles.append(item['link'])
        titles = map(lambda x: x.rsplit('/', 1)[1], titles)    

        best_title = difflib.get_close_matches(search, titles, n=1, cutoff=.5)
        if len(best_title) == 0 and len(items) > 0:
            print 'NO MATCH: ' + search
            pprint.pprint(items)
            continue
        
        th = {}
        th['sc_name_corr'] = search
        idx = titles.index(best_title[0])
        item = items[idx]
        th['link_st'] = item['link'] 
        th['title_st'] = item['title']
        if item.get('pagemap'):
            t0 = item['pagemap']['cse_thumbnail'][0]
            th['th_src'] = t0['src'] 
            th['th_width'] = t0['width']
            th['th_height'] = t0['height']
        
        thumbs.append(th)
    pprint.pprint(thumbs)
    thumbs = pandas.DataFrame(thumbs)
    db = db.merge(thumbs, on='sc_name_corr', how='left')
    db.to_json(FILE_DB_SPECIES, orient='records')    
    
    return
    
def resetEOLLink(l):
    if l != None and ('pages' not in l or 'overview' not in l):
        return None
    return l   

def improveEOLLink():
    db = pandas.read_json(FILE_DB_SPECIES, orient='records') 
    db.drop(['link', 'title'], axis=1, inplace=True)
    service = apiclient.discovery.build('customsearch', 'v1',
            developerKey=keys['searchkey'][0])
    thumbs = []
    counter = 0
    for _, si in db.iterrows(): 
        search = si['sc_name_corr']
        res = service.cse().list(
                q=search + ' tree', 
                cx=keys['eolsearch'][0],
                fields='items(title,link)')\
                .execute()
        counter += 1
        if counter % 20 == 0:
            # show progress
            print counter
        items = res.get('items')
        if not items:
            print 'NO RESULT: ' + search
            pprint.pprint(res)
            continue

        titles = []
        for item in items:
            if re.search('pages\\/[0-9]+\\/overview$', item['link']):
                titles.append(item['title'])
        if len(titles) == 0:
            print 'NO USABLE RESULT: ' + search
            continue
        
        titles_search = map(lambda x: x.split(' - ')[:2], titles)
        titles_search = list(itertools.chain.from_iterable(titles_search))
        titles_search = map(lambda x: x.split('(')[0].strip(), titles_search)
        
        best_title = difflib.get_close_matches(search, titles_search, n=1, cutoff=.7)
        if len(best_title) == 0 and len(titles) > 0:
            continue

        th = {}
        th['sc_name_corr'] = search
        th['corrected'] = best_title[0]
        for t in titles:
            if best_title[0] in t:
                for item in items:
                    if t == item['title']:
                        th['link_eol'] = item['link'] 
                        th['title_eol'] = item['title']
        
        thumbs.append(th)

    thumbs = pandas.DataFrame(thumbs)

    db = db.merge(thumbs, on='sc_name_corr', how='left')
    #db.to_json(FILE_DB_SPECIES, orient='records') 
    #db.to_csv('species3.csv', quoting=csv.QUOTE_NONNUMERIC, 
     #               encoding='UTF-8')     
    return
    
    
##################################  
    
def createSpeciesList():
    trees = pandas.read_json(FILE_TREES, orient='records')
    print len(trees)
    species = cleanSpeciesNames(trees, 'qspecies')
    species = species[species != ''] 
    species = numpy.sort(species.drop_duplicates())  
    species = pandas.DataFrame(species)
    print len(species)
    species.to_json(FILE_SPECIES, orient='records') 
    species.to_csv('species.csv', quoting=csv.QUOTE_NONNUMERIC, 
                    encoding='UTF-8')
    return
    
def lookupSpecies():
    db = pandas.read_json(FILE_DB_SPECIES, orient='records')
    species = pandas.read_json(FILE_SPECIES, orient='records')
    # remove empty row
    species = species[1:]
    # lookup on cleaned name, which might contain uncommon spellings
    lookup = db.merge(species, left_on='name', right_on=0.0, how='inner') 
    lookup.drop(0.0, axis=1, inplace=True)
    print len(species)
    return    
    
    
######################################

# regex for removal of x
re_x = re.compile('^[0-9\\- ]+X')

def removeX(a):
    """ Removes 'x' after house number. """
    a = a.strip()
    match = re_x.match(a)
    if match:
        a = a[:match.end()-1] + a[match.end():]
    return a
    
def combineTree():    
    trees = pandas.read_json(FILE_TREES, orient='records')
    trees['qaddress'] = trees['qaddress'].apply(lambda x: unicode(x).upper()) 
    trees['qaddress'] = trees['qaddress'].apply(lambda x: removeX(x))
    realest = pandas.read_json(FILE_PROPERTY_SUMMED, orient='records')
    hits = realest.merge(trees, left_on=['cleaned'], right_on=['qaddress'], how='inner')
    outer = realest.merge(trees, left_on=['cleaned'], right_on=['qaddress'], how='outer')
    realest = outer.drop(hits.index.values)
    print realest['cleaned']                                  
    return





if __name__ == "__main__":
    # api keys etc    
    keys = pandas.read_csv('keyfile.csv')
    
    #convertExcel()
    #cleanAddresses()

    #geocode()

    # updateSpeciesDB()
    
    #sumValues()
    #combineRESumGeo()
    toGeoJson()
    
    ##cleanTrees()
    #createSpeciesList()
    #lookupSpecies()    
  

    #combineTree()
    
             
                        
    



    
  
        
