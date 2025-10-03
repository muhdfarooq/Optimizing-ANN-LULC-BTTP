// LST (seasonal mean) region min/max/mean (Ermida SMW module)
// https://github.com/sofiaermida/Landsat_SMW_LST.git
// - USER CONFIG: set your ROI, date range, and other flags below
// - Years are NOT hard-coded: the script builds the year list from the date range
// - Default season is May - Sep (change seasonStartMonth / seasonEndMonth if needed)
// - Does NOT contain any project-specific asset path; replace roiAsset with your own asset if needed

// -------------------- USER CONFIG --------------------
var roiAsset = 'REPLACE_WITH_YOUR_ROI_ASSET'; // e.g. 'users/yourname/your_asset' OR set roi = ee.FeatureCollection(...) directly
var startDate = '2013-01-01';  // earliest date to search (change if required)
var endDate   = '2024-12-31';  // latest date to search (change if required)

// season months (default: May - Sep). Change or leave as-is.
var seasonStartMonth = 5;
var seasonEndMonth   = 9;

// If you prefer to manually set years, set manualYears = [2013,.....,2024].
// Otherwise leave as [] to auto-generate from startDate/endDate.
var manualYears = [];
// Pass NDVI to Ermida module if desired (true/false)
var use_ndvi = true;

// Satellite token used by Ermida module (L8)
var sat = 'L8';
// -----------------------------------------------------

// Load ROI: either from asset path or leave blank and set roi below manually
var roi;
if (roiAsset && roiAsset !== 'REPLACE_WITH_YOUR_ROI_ASSET') {
  roi = ee.FeatureCollection(roiAsset);
} else {
  // If you prefer to create/paste a geometry here, uncomment and edit the line below:
  // roi = ee.FeatureCollection(ee.Feature(ee.Geometry.Polygon([[ /* your coordinates */ ]]), {}));
  throw Error('Please set "roiAsset" to your ROI FeatureCollection asset or set "roi" manually in the script.');
}

var ROIgeom = roi.geometry();
Map.centerObject(roi, 9);

// Load Ermida's LST module (keep this as-is)
var LandsatLST = require('users/sofiaermida/landsat_smw_lst:modules/Landsat_LST.js');

// Helper: build years list from startDate/endDate if manualYears empty
var years = manualYears;
if (years.length === 0) {
  var sYear = ee.Date(startDate).get('year').getInfo();
  var eYear = ee.Date(endDate).get('year').getInfo();
  years = [];
  for (var y = sYear; y <= eYear; y++) {
    years.push(y);
  }
}

// Combined reducer: min, max, mean (shared inputs)
var combinedReducer = ee.Reducer.min()
  .combine({reducer2: ee.Reducer.max(), sharedInputs: true})
  .combine({reducer2: ee.Reducer.mean(), sharedInputs: true});

// Iterate years (client-side loop)
years.forEach(function(year) {
  year = parseInt(year, 10);

  // Build season start/end for this year (server-side dates passed as ISO strings)
  var start = ee.Date.fromYMD(year, seasonStartMonth, 1).format('YYYY-MM-dd');
  // end: last day of seasonEndMonth. Use .advance to get next month first day & subtract 1 day robustly if needed.
  var end = ee.Date.fromYMD(year, seasonEndMonth, 1).advance(1, 'month').advance(-1, 'day').format('YYYY-MM-dd');

  // fetch LST images from Ermida module
  var coll = LandsatLST.collection(sat, start, end, ROIgeom, use_ndvi)
             .filter(ee.Filter.listContains('system:band_names', 'LST'));

  var count = coll.size().getInfo();
  if (count === 0) {
    print('LST: Year ' + year + ': no L8 LST images → skipping');
    return;
  }

  // mean seasonal LST image
  var meanImg = coll.mean().clip(ROIgeom);

  // Add mean LST (Kelvin) to map (visual params optional)
  Map.addLayer(meanImg.select('LST'), {min:290, max:320, palette: ['blue','cyan','green','yellow','red']}, 'Mean LST ' + year);

  // Region min/max/mean in Kelvin
  var lstStatsK = meanImg.select('LST').reduceRegion({
    reducer: combinedReducer,
    geometry: ROIgeom,
    scale: 30,
    maxPixels: 1e13
  });
  print('--- Region LST (K) stats for ' + year + ' (season ' + seasonStartMonth + '-' + seasonEndMonth + ') ---');
  print(lstStatsK); // keys: 'LST_min','LST_max','LST_mean'

  // Region min/max/mean in Celsius (server-side conversion)
  var meanImgC = meanImg.select('LST').subtract(273.15).rename('LST_C');
  var lstStatsC = meanImgC.reduceRegion({
    reducer: combinedReducer,
    geometry: ROIgeom,
    scale: 30,
    maxPixels: 1e13
  });
  print('--- Region LST (°C) stats for ' + year + ' (season ' + seasonStartMonth + '-' + seasonEndMonth + ') ---');
  print(lstStatsC); // keys: 'LST_C_min','LST_C_max','LST_C_mean'

  // ------------------ Optional: High-quality Export to Google Drive ------------------
  // If getThumbURL fails or you want guaranteed high-res images, uncomment the blocks below,
  // then run the script and start the Exports from the "Tasks" tab in the Code Editor.
  //
  // The exports use image.visualize(...) to produce an RGB PNG using your palette.
  //
  /*
  Export.image.toDrive({
    image: meanImg.select('LST').visualize({min: 290, max: 320, palette: ['blue','cyan','green','yellow','red']}),
    description: 'LST_' + year + '_PNG',
    folder: 'GEE_exports',
    fileNamePrefix: 'LST_' + year + '_PNG',
    region: ROIgeom,
    scale: 30,            // Landsat native resolution
    maxPixels: 1e13
  });
  */

}); // end years loop

Map.centerObject(roi, 9);
