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


FILE_PROPERTY = 'property.json'
FILE_ADDRESSES = 'addresses.json'
FILE_ADDRESSES_GEO = 'addresses_geo.json'
FILE_PROPERTY_SUMMED = 'property_summed.json'
FILE_COMBINED = 'combined.json'
FILE_TREES = 'sftrees.json'
FILE_SPECIES = 'treespecies.json'


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
    gmaps = googlemaps.Client(key=keys['gmapskey'])
    max_requests = 15000
    skip_first = 113000
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
    summed = pandas.read_json(FILE_PROPERTY_SUMMED, orient='records')

    combined = summed.merge(geo_addresses, left_on='cleaned', right_on='addr', 
                         how='inner')
              
    combined.to_json(FILE_COMBINED, orient='records') 
    combined.to_csv('combined.csv', quoting=csv.QUOTE_NONNUMERIC, 
                    encoding='UTF-8')
    return
    
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
    
def enrichTree():
    """ Cleans the species names of the trees and gets additional information
    by searching the Encyclopedia of Life through Google. Result saved as json.
    """
    trees = pandas.read_json(FILE_TREES, orient='records')
    print len(trees)
    species = trees['qspecies'].drop_duplicates()
    # remove common name
    species = species.apply(lambda x: x.split('::')[0].strip())
    # remove variety name
    species = species.apply(lambda x: x.split('\'')[0].strip())
    # remove additional comments
    species = species.apply(lambda x: x.split('\\(')[0].strip())
    # remove unhelpful additions
    species = species.apply(lambda x: re.sub('spp|Spp\\.?', '', x).strip())
    species = species.apply(lambda x: re.sub('\\sx$|^x\\s+', '', x).strip())
    species = species[species != '']
    species = numpy.sort(species.drop_duplicates())
    
    service = apiclient.discovery.build('customsearch', 'v1',
            developerKey=keys['searchkey'])
    species_infos = []
    counter = 0
    for s in species:
        res = service.cse().list(
            q=s, cx=keys['eolsearch'],
            fields='spelling/correctedQuery,items(title,link').execute()
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
                cx=keys['eolsearch'],
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

def treeAddThumbs():
    """ Adds 2 thumbnail urls from Wikimedia Commons. """ 
    species_infos = pandas.read_json(FILE_SPECIES, orient='records')
    
    service = apiclient.discovery.build('customsearch', 'v1',
            developerKey=keys['searchkey'])
    thumbs = []
    counter = 0
    for ix, si in species_infos.iterrows(): 
        search = si['name'] if si['corrected'] == None else si['corrected']
        res = service.cse().list(
                q=search + ' tree', 
                cx=keys['wikisearch'],\
                fields='items(title,link),items/pagemap/cse_thumbnail',\
                gl='en').execute()
        counter += 1
        if counter % 20 == 0:
            # show progress
            print counter
        if not res.get('items'):
            print si['name']
            pprint.pprint(res)
            continue
        th = {}
        th['name'] = si['name']
        thumb_count = 0
        for item in res.get('items'): 
            #find 2 thumbnails
            if not item.get('pagemap'):
                continue
            else:
                thumb_count +=1
            th['link_'+str(thumb_count)] = item['link'] 
            th['title_'+str(thumb_count)] = item['title'] 
            t0 = item['pagemap']['cse_thumbnail'][0]
            th['src_'+str(thumb_count)] = t0['src'] 
            th['width_'+str(thumb_count)] = t0['width']
            th['height_'+str(thumb_count)] = t0['height']    
            if thumb_count == 2:
                break
        if thumb_count < 2:
            print si['name']
            pprint.pprint(res)
        thumbs.append(th)
    thumbs = pandas.DataFrame(thumbs)
    species_infos = species_infos.merge(thumbs, on='name', how='left')
    species_infos.to_json(FILE_SPECIES, orient='records') 
    species_infos.to_csv('species.csv', quoting=csv.QUOTE_NONNUMERIC, 
                    encoding='UTF-8')

    return


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
    #sumValues()
    
    #geocode()
    
    #combineRESumGeo()
    
    ##cleanTrees()
    #combineTree()
    
    #enrichTree()
    treeAddThumbs()
    

    
    
   

    
  
        
