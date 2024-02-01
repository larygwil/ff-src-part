#!/bin/bash

git checkout master
git clean -f
git clean -f -d

echo ""
echo ""

# 存储当前目录的路径到GITREPO
GITREPO="$(pwd)"

# 存储“$GITREPO/firefox-src-part”的路径到FF_SRC_GIT
FF_SRC_GIT="$GITREPO/firefox-src-part"

# 获取Firefox的最新版本并存到VER_LATEST
# 注意：这里假设有一个有效的API或方式来获取该最新版本
# VER_LATEST=$(wget -q -O - "https://api.github.com/repos/firefox/releases/latest" | awk -F '[:"]' '/tag_name/{print $4}') 
# VER_LATEST="$(curl -s https://product-details.mozilla.org/1.0/firefox_versions.json| jq -r '.LATEST_FIREFOX_VERSION')"  || exit 1
VER_LATEST="$(curl -s https://product-details.mozilla.org/1.0/firefox_versions.json| jq -r '.LATEST_FIREFOX_RELEASED_DEVEL_VERSION')"  || exit 1
echo "Latest Firefox version: $VER_LATEST"

# 获取存储在$GITREPO/version.txt的版本号
VER_FILE=$(cat "$GITREPO/version.txt")
echo "Saved version: $VER_FILE"

# 使用 'sort -V' 将两个版本号进行比较，如果VER_LATEST版本号较大，则继续
if [[ ! $(printf '%s\n' "$VER_LATEST" "$VER_FILE" | sort -V | tail -n 1) = "$VER_LATEST" ]]
then
    echo "No larger version found"
    exit 0
fi
  
cd $HOME || exit 1
# 下载并解压VER_LATEST版本的Firefox源码到临时目录
# wget "https://example.com/path/to/firefox-$VER_LATEST.tar.gz"
SOURCE_TAR="firefox-${VER_LATEST}.source.tar.xz"
SOURCE_TAR_URL="https://ftp.mozilla.org/pub/firefox/releases/${VER_LATEST}/source/${SOURCE_TAR}"
echo "Download new source tarball ..."
wget "$SOURCE_TAR_URL"  || exit 1

echo "Extract tarball..."
tar -xf "$SOURCE_TAR" || exit 1
EXTRACTED_DIR="firefox-${VER_LATEST/esr/}"
FF_LATEST_TMP="$PWD/$EXTRACTED_DIR"

# 删除FF_SRC_GIT中除了.git之外的所有文件和目录
cd "$FF_SRC_GIT" || exit 1
echo "Delete old Firefox source..."
# find "$FF_SRC_GIT" -mindepth 1 ! -regex '^.*\.git.*$' -exec rm -r {} \;
rm -r * || exit 1

# 切换到FF_LATEST_TMP目录并执行$GITREPO/del-uneeded.sh
cd "$FF_LATEST_TMP" || exit 1
function del_uneeded() {
    rm -r   intl/icu \
            third_party \
            gfx \
            toolkit/crashreporter \
            toolkit/components/translation \
            toolkit/components/protobuf \
            toolkit/components/telemetry \
            js \
            dom/media/platforms \
            devtools/docs \
            security \
            media \
            modules/freetype2 \
            modules/zlib \
            mobile/android/fonts \
            mobile/android/exoplayer2 \
            other-licenses \
            config/external/icu \
            devtools/client/shared/sourceeditor/codemirror \
            devtools/client/shared/vendor \
            devtools/client/shared/build \
            devtools/client/debugger/dist \
            tools \
            
            
            
    find .  -iname "*test*"  -exec rm -r {} \;  2>/dev/null
    find .  -iname "*benchmark*"  -exec rm -r {} \;  2>/dev/null
    find .  -iname "*example*"  -exec rm -r {} \;  2>/dev/null

    find .  \( -type f -and ! \( \
                -name '*.xml' \
                -or -name '*.mjs' \
                -or -name '*.jsm' \
                -or -name '*.html' \
                -or -name '*.xhtml' \
                -or -name '*.js' \
                -or -name '*.jsx' \
                -or -name '*.xul' \
                -or -name '*.idl' \
                -or -name '*nsI*' \
                -or -name "*Glue*" \
                -or -name "*.css" \
                -or -name "*.scss" \
            \) \) -delete  2>/dev/null
        
    find .  \( ! -name . -prune \) \( ! -name .. -prune \) -name ".*"   -exec rm -r {} \;  2>/dev/null

    while read -r line
    do
        rm "$line"
    done< <(grep -rIL .)

    # 
    # for file in $(find . -type f)
    # do
    #     # 使用 grep -E 命令检查文件是否只包含空格或者换行
    #     if ! grep -Eq "\S" "$file"; then
    #         echo "empty file: $file"
    #     fi
    # done
        
        
    find .  -type d -empty -delete  2>/dev/null
    
    return 0
}
echo "Delete unneded files in new Firefox source ..."
del_uneeded || exit 1

# 将FF_LATEST_TMP中的所有文件和目录复制到FF_SRC_GIT
echo "Copy new codes to git folder..."
cp -r ./* "$FF_SRC_GIT" || exit 1

# 将VER_LATEST添加到$GITREPO/version.txt并进行git commit
echo "$VER_LATEST" > "$GITREPO/version.txt"
cd "$GITREPO" || exit 1
git config user.name bot
git config user.email bot@ci-bot.nodomain.none

git add . || exit
git commit -m "$VER_LATEST" || exit
git tag "$VER_LATEST" 
git push -u origin || exit 1
git push -u origin --tags


