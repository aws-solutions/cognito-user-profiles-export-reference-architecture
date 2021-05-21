#!/bin/bash
#
# This assumes all of the OS-level configuration has been completed and git repo has already been cloned
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./build-s3-dist.sh source-bucket-base-name solution-name version-code
#
# Paramenters:
#  - source-bucket-base-name: Name for the S3 bucket location where the template will source the Lambda
#    code from. The template will append '-[region_name]' to this bucket name.
#    For example: ./build-s3-dist.sh solutions v1.0.0
#    The template will then expect the source code to be located in the solutions-[region_name] bucket
#
#  - solution-name: name of the solution for consistency
#
#  - version-code: version of the package

# Check to see if input has been provided:
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Please provide the base source bucket name, trademark approved solution name and version where the lambda code will eventually reside."
    echo "For example: ./build-s3-dist.sh solutions trademarked-solution-name v1.0.0"
    exit 1
fi

# Get reference for all important folders
template_dir="$PWD"
template_dist_dir="$template_dir/global-s3-assets"
build_dist_dir="$template_dir/regional-s3-assets"
source_dir="$template_dir/../source"

echo "------------------------------------------------------------------------------"
echo "[Init] Clean old dist, node_modules and bower_components folders"
echo "------------------------------------------------------------------------------"
echo "rm -rf $template_dist_dir"
rm -rf $template_dist_dir
echo "mkdir -p $template_dist_dir"
mkdir -p $template_dist_dir
echo "rm -rf $build_dist_dir"
rm -rf $build_dist_dir
echo "mkdir -p $build_dist_dir"
mkdir -p $build_dist_dir

echo "------------------------------------------------------------------------------"
echo "[Packing] Templates"
echo "------------------------------------------------------------------------------"
SUB_BUCKET_NAME="s/BUCKET_NAME_PLACEHOLDER/$1/g"
SUB_SOLUTION_NAME="s/SOLUTION_NAME_PLACEHOLDER/$2/g"
SUB_VERSION="s/VERSION_PLACEHOLDER/$3/g"

for FULLNAME in ./*.yaml
do
  TEMPLATE=`basename $FULLNAME .yaml`
  echo "Template: $TEMPLATE"
  sed -e $SUB_BUCKET_NAME -e $SUB_SOLUTION_NAME -e $SUB_VERSION $template_dir/$TEMPLATE.yaml > $template_dist_dir/$TEMPLATE.template
  cp $template_dist_dir/$TEMPLATE.template $build_dist_dir/
done

echo "------------------------------------------------------------------------------"
echo "[Building] Utils"
echo "------------------------------------------------------------------------------"
cd $source_dir/utils
npm run clean
npm install --production

declare -a lambda_packages=(
  "custom-resources"
  "workflow-common"
  "workflow-export"
  "workflow-import"
)

for lambda_package in "${lambda_packages[@]}"
do
  echo "------------------------------------------------------------------------------"
  echo "[Building] Lambda package: $lambda_package"
  echo "------------------------------------------------------------------------------"
  cd $source_dir/$lambda_package
  npm run package

  # Check the result of the build and exit if a failure is identified
  if [ $? -eq 0 ]
  then
    echo "[Building] Package for $lambda_package built successfully"
  else
    echo "------------------------------------------------------------------------------"
    echo "[ERROR] Package build FAILED for $lambda_package"
    echo "------------------------------------------------------------------------------"
    exit 1
  fi
  mv ./dist/package.zip $build_dist_dir/$lambda_package.zip
  npm run clean
done
